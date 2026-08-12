"use strict";

((root, factory) => {
  const api = Object.freeze(factory());
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }
  Object.defineProperty(root, "AlgoLoomV03SourceGuard", {
    value: api,
    configurable: false,
    enumerable: false,
    writable: false,
  });
})(globalThis, () => {
  function defaultIsVisible(element) {
    if (!element || typeof element.getClientRects !== "function") return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function toggleIsActive(editorToggle) {
    return Boolean(
      editorToggle &&
      editorToggle.classList &&
      typeof editorToggle.classList.contains === "function" &&
      editorToggle.classList.contains("active"),
    );
  }

  function isPlainEditorMode(
    sourceField,
    editorElement,
    editorToggle,
    isVisible = defaultIsVisible,
  ) {
    return (
      isVisible(sourceField) &&
      !isVisible(editorElement) &&
      toggleIsActive(editorToggle)
    );
  }

  function isAceEditorMode(
    sourceField,
    editorElement,
    editorToggle,
    isVisible = defaultIsVisible,
  ) {
    return (
      !isVisible(sourceField) &&
      isVisible(editorElement) &&
      !toggleIsActive(editorToggle)
    );
  }

  function serializedSourceMatches(
    {
      form,
      sourceField,
      editorElement,
      editorToggle,
      expectedSource,
      expectedByteCount,
    },
    {
      isVisible = defaultIsVisible,
      createFormData = (value) => new FormData(value),
      byteLength = (value) => new TextEncoder().encode(value).length,
    } = {},
  ) {
    if (
      !form ||
      !sourceField ||
      sourceField.form !== form ||
      sourceField.disabled ||
      sourceField.name !== "sourceCode" ||
      typeof expectedSource !== "string" ||
      expectedSource.length === 0 ||
      !Number.isInteger(expectedByteCount) ||
      expectedByteCount <= 0 ||
      !isPlainEditorMode(
        sourceField,
        editorElement,
        editorToggle,
        isVisible,
      ) ||
      sourceField.value !== expectedSource ||
      byteLength(sourceField.value) !== expectedByteCount
    ) {
      return false;
    }

    let values;
    try {
      values = createFormData(form).getAll("sourceCode");
    } catch (_) {
      return false;
    }
    return (
      values.length === 1 &&
      typeof values[0] === "string" &&
      values[0] === expectedSource &&
      byteLength(values[0]) === expectedByteCount
    );
  }

  return { isAceEditorMode, isPlainEditorMode, serializedSourceMatches };
});
