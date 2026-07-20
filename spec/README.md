---
status: normative
applies_to: MVP
derived_from:
  - ../docs/product/vision.md
  - ../docs/product/mvp.md
  - ../docs/architecture/core-contracts.md
---

# AlgoLoom 開発用仕様

## 1. 目的

`spec/`は、AlgoLoomの実装とtestに必要な範囲、原則、不変条件を、`docs/`の設計文書から抽出した開発用仕様です。設計理由、比較検討、将来構想をすべて複製せず、現在の実装判断を拘束する内容だけを示します。

このdirectoryの目的は、設計思想を省略することではありません。実装者が設計思想から外れずに作業できるよう、実装へ影響する形へ短く投影することです。背景や判断理由が必要な場合は、各文書の`derived_from`に示す設計文書を参照します。

## 2. 文書一覧

| 文書 | 実装時に確認する内容 |
|---|---|
| [製品・実装原則](principles.md) | 実装方法を変えても維持する製品上の不変条件 |
| [MVP実装範囲](scope.md) | 対象利用者、対応環境、実装対象、対象外、開始・完了条件 |
| [Core開発契約](core-contracts.md) | workspace、test、履歴、提出、保存、errorと回復の契約 |

個別interface、永続化Schema、CLI、acceptance test等は、設計上の未決事項が確定した段階で追加します。未確定の詳細を`spec/`で先に確定したように扱いません。

## 3. 正本と優先順位

このリポジトリ全体が、AlgoLoomの製品設計と開発用仕様の正本です。ただし、同じ事実を複数箇所で独立して決定しません。

1. 製品思想と製品全体の構想は[`docs/product/vision.md`](../docs/product/vision.md)を正とします。
2. MVPの範囲は[`docs/product/mvp.md`](../docs/product/mvp.md)を正とします。
3. Coreの不変契約は[`docs/architecture/core-contracts.md`](../docs/architecture/core-contracts.md)を正とします。
4. 個別領域は、設計文書で明示された各正本文書を正とします。
5. `spec/`はそれらを実装向けに投影し、新しい製品判断を単独では追加しません。

`docs/`と`spec/`が矛盾した状態は、どちらかを選んで実装するのではなく、修正が必要な設計不整合として扱います。矛盾を解消するまでは、該当する正本の設計文書を優先します。

## 4. 変更規則

### 4.1. 設計を変更する場合

製品の挙動、MVP範囲、データの意味、安全性、外部作用またはUX契約を変更する場合は、同じ変更で次を行います。

1. 正本となる`docs/`の設計文書を更新する。
2. 影響する`spec/`を更新する。
3. 文書間のリンク、用語、範囲、不変条件を確認する。
4. 実装リポジトリが参照するdesign revisionを更新する。

### 4.2. 実装中に変更の必要が判明した場合

- module構成、dependency、build、CI、test fixture等、製品契約を変えない実装判断は、実装リポジトリのengineering文書またはADRで管理します。
- 製品の挙動、範囲、原則、不変条件を変える判断は、先にこのリポジトリへ変更提案として戻します。
- 確定前の実装上の発見はissueまたはADRから設計変更へ参照できますが、実装リポジトリのsnapshotを直接編集して正本にしません。

情報と問題提起は双方向に流しますが、確定した開発用仕様はこのリポジトリから実装リポジトリへの一方向で配布します。

## 5. 実装リポジトリへの同期契約

実装リポジトリでは、次の構成を推奨します。

```text
docs/
├── product-spec/       # このspec/の読み取り専用snapshot
└── engineering/        # 実装リポジトリを正本とする文書
design-spec.lock        # 同期元repository、revision、path
```

同期したsnapshotには、少なくとも次を記録します。

```yaml
repository: mgmaru/algo-loom-design
revision: <commit SHA or tag>
path: spec/
```

- `product-spec/`を実装リポジトリだけで変更しません。
- 同期時は追加・変更・削除を含むdirectory全体の一致を確認します。
- `derived_from`と本文中の設計文書リンクは、`design-spec.lock`のrevisionに固定したpermalink等へ同期処理で解決し、snapshot内にリンク切れを残しません。
- 実装PRでは、参照中のdesign revisionと、製品契約への影響有無を確認します。
- 自動検査ではsnapshotの一致、revision、リンクを確認できます。意味上の一貫性は設計reviewとacceptance testでも確認します。

Git submodule等の特定の同期方式は、実装リポジトリを作成した時点で、offline参照、更新の容易さ、CI、review時の差分を比較して決定します。同期方式そのものを製品設計の契約にはしません。

## 6. 文書の記述規則

各開発用仕様は、先頭に次を記録します。

```yaml
status: normative | draft
applies_to: MVP | post-MVP
derived_from:
  - ../docs/path/to/source.md
```

- `normative`は現在の実装とtestを拘束します。
- `draft`は未決事項を含み、確定済みの実装契約として扱いません。
- 要件は可能な限り「何を満たすか」「何をしてはならないか」「どう検証するか」が分かる形で記述します。
- 暫定的なcommand名、class名、table名を、確定したinterfaceとして扱いません。
- 設計理由を長く複製せず、必要な正本文書と節へリンクします。
