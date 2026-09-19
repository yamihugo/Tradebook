/**
 * Numeric inputs, without the browser's own verdict.
 *
 * Chromium paints a constraint-validation popup ("Please enter a valid
 * value…") for any `input[type=number]` whose value breaks its own `step`
 * rule — a ratio with `step="0.5"` rejects `0.3`, a field with no `step`
 * rejects `6.5` because the default step is 1. That bubble is drawn by the
 * browser and cannot be styled, so it lands in the middle of a dark modal
 * looking like a bug.
 *
 * `freeNumeric` removes the conditions that produce it. It changes nothing
 * about what we accept: the bounds live in the handlers that read the value
 * (they clamp), not in the markup — and `min`/`max` on a number input never
 * blocked a keystroke anyway, they only fed the bubble and the spinner.
 */
export function freeNumeric(input: HTMLInputElement): HTMLInputElement {
  input.step = "any";
  input.removeAttribute("min");
  input.removeAttribute("max");
  input.addEventListener("invalid", (ev) => ev.preventDefault());
  input.closest("form")?.setAttribute("novalidate", "");
  return input;
}
