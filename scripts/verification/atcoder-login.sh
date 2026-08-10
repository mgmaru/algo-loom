#!/usr/bin/env bash

# Review-only helper for the JudgeAdapter verification.
#
# This script prepares an isolated Python environment outside the repository,
# installs the versions used by the verification, and delegates authentication
# to online-judge-tools. It does not accept credentials as arguments and does
# not copy browser cookies.

set -uo pipefail

readonly ATCODER_URL='https://atcoder.jp/'
readonly ONLINE_JUDGE_TOOLS_VERSION='11.5.1'
readonly ONLINE_JUDGE_API_CLIENT_VERSION='10.10.1'
readonly URLLIB3_VERSION='1.26.20'

VERIFY_ROOT=''

usage() {
  printf '%s\n' \
    'Usage:' \
    '  ./scripts/verification/atcoder-login.sh' \
    '' \
    'The script creates an isolated temporary directory, installs the pinned' \
    'verification dependencies with uv, and prompts for the AtCoder username' \
    'and password through online-judge-tools.'
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit "${2:-1}"
}

report_verify_root() {
  local exit_status=$?
  trap - EXIT

  if [[ -n "$VERIFY_ROOT" ]]; then
    printf '\nVerification directory: %s\n' "$VERIFY_ROOT"
    printf 'Do not paste cookie.jar or its contents into chat, logs, or documents.\n'
    printf 'Keep this directory until the V-02 account check is complete.\n'
  fi

  exit "$exit_status"
}

directory_mode() {
  local target=$1
  local mode

  if mode=$(stat -f '%Lp' "$target" 2>/dev/null); then
    printf '%s\n' "$mode"
    return 0
  fi
  if mode=$(stat -c '%a' "$target" 2>/dev/null); then
    printf '%s\n' "$mode"
    return 0
  fi
  return 1
}

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 64
fi

SCRIPT_DIRECTORY=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) \
  || fail 'cannot resolve the script directory'
readonly SCRIPT_DIRECTORY
REPOSITORY_ROOT=$(git -C "$SCRIPT_DIRECTORY" rev-parse --show-toplevel 2>/dev/null) \
  || fail 'cannot resolve the repository root'
readonly REPOSITORY_ROOT

if [[ -n "${ALGOLOOM_UV_BIN:-}" ]]; then
  UV_BIN=$ALGOLOOM_UV_BIN
else
  UV_BIN=$(command -v uv 2>/dev/null || true)
fi
readonly UV_BIN
[[ -n "$UV_BIN" ]] \
  || fail 'uv was not found on PATH' 69
case "$UV_BIN" in
  /*) ;;
  *) fail 'uv must resolve to an absolute path' 69 ;;
esac
[[ -x "$UV_BIN" ]] \
  || fail 'uv does not point to an executable file' 69

if [[ -n "${ALGOLOOM_PYTHON_BIN:-}" ]]; then
  PYTHON_BIN=$ALGOLOOM_PYTHON_BIN
else
  PYTHON_BIN='/usr/bin/python3'
fi
readonly PYTHON_BIN
case "$PYTHON_BIN" in
  /*) ;;
  *) fail 'Python must resolve to an absolute path' 69 ;;
esac
[[ -x "$PYTHON_BIN" ]] \
  || fail 'Python 3 was not found at /usr/bin/python3' 69

TEMPORARY_BASE=${TMPDIR:-/tmp}
TEMPORARY_BASE=$(cd -- "$TEMPORARY_BASE" && pwd -P) \
  || fail 'cannot resolve the temporary directory'
readonly TEMPORARY_BASE
case "$TEMPORARY_BASE" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*)
    fail 'the temporary directory must be outside the repository' 64
    ;;
esac

VERIFY_ROOT=$(mktemp -d "${TEMPORARY_BASE}/algoloom-atcoder.XXXXXX") \
  || fail 'cannot create the verification directory'
readonly VERIFY_ROOT
trap report_verify_root EXIT

VERIFY_ROOT_MODE=$(directory_mode "$VERIFY_ROOT") \
  || fail 'cannot inspect the verification directory permissions'
readonly VERIFY_ROOT_MODE
[[ "$VERIFY_ROOT_MODE" == '700' ]] \
  || fail "the verification directory must have mode 700; observed ${VERIFY_ROOT_MODE}" 64

readonly VENV_DIRECTORY="${VERIFY_ROOT}/venv"
readonly STATE_DIRECTORY="${VERIFY_ROOT}/state"
readonly COOKIE_PATH="${STATE_DIRECTORY}/cookie.jar"

(umask 077 && mkdir "$STATE_DIRECTORY") \
  || fail 'cannot create the authentication state directory'

printf 'Preparing the isolated login environment\n'
printf '  root: %s\n' "$VERIFY_ROOT"
printf '  Python: %s\n' "$PYTHON_BIN"
printf '  uv: %s\n' "$UV_BIN"
printf '\n'

"$UV_BIN" venv \
  --python "$PYTHON_BIN" \
  "$VENV_DIRECTORY" \
  || fail 'failed to create the Python virtual environment'

"$UV_BIN" pip install \
  --python "${VENV_DIRECTORY}/bin/python" \
  --default-index 'https://pypi.org/simple' \
  "online-judge-tools==${ONLINE_JUDGE_TOOLS_VERSION}" \
  "online-judge-api-client==${ONLINE_JUDGE_API_CLIENT_VERSION}" \
  "urllib3==${URLLIB3_VERSION}" \
  || fail 'failed to install the verification dependencies'

readonly OJ_BIN="${VENV_DIRECTORY}/bin/oj"
[[ -x "$OJ_BIN" ]] \
  || fail 'the oj executable was not created' 70

printf '\nAtCoder login verification\n'
printf '  cookie file: %s\n' "$COOKIE_PATH"
printf '  browser login: disabled\n'
printf '  automatic login retry: disabled\n'
printf '\n'
printf 'Important: online-judge-tools %s does not expose HTTP timeout or request-interval controls for this login path.\n' "$ONLINE_JUDGE_TOOLS_VERSION"
printf 'Stop manually if it does not return in a reasonable time.\n'
printf '\n'

"$OJ_BIN" \
  -c "$COOKIE_PATH" \
  login "$ATCODER_URL" \
  --use-browser=never
readonly LOGIN_STATUS=$?

if [[ -f "$COOKIE_PATH" ]]; then
  chmod 600 "$COOKIE_PATH" \
    || fail 'login finished, but the cookie file permissions could not be restricted'
fi

if [[ $LOGIN_STATUS -ne 0 ]]; then
  printf '\nLogin was not established (oj exit code %d).\n' "$LOGIN_STATUS" >&2
  printf 'No retry was attempted. Do not proceed to submission.\n' >&2
  exit "$LOGIN_STATUS"
fi

[[ -s "$COOKIE_PATH" ]] \
  || fail 'oj reported success, but no non-empty cookie file was created' 70

printf '\nLogin was established according to oj.\n'
printf 'This does not identify the authenticated account; run the separate V-02 account check before submission.\n'
