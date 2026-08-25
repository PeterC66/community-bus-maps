// Filling a static HTML shell, server-side.
//
// The public pages are plain files in public/ that @fastify/static serves as
// they are. Two of them — /maps and /m/<slug>/services — must arrive with their
// content already in them rather than fetching it (technical-audit_2026-08-25 N1),
// and this is the small amount of machinery that does it.
//
// WHY STRING SURGERY AND NOT A TEMPLATE ENGINE. The shells are also the files a
// browser renders directly during development, the files check-chrome.mjs
// asserts the nav and footer of, and the files a designer edits. Introducing a
// template syntax would make them stop being any of those things, for a page
// count in single figures. Three targeted replacements are cheaper than a
// dependency and a build step.
//
// EVERY HELPER THROWS WHEN IT CANNOT FIND ITS TARGET, and that is the point.
// A silent no-op would put us straight back where we started — a page that looks
// finished and is empty — and it would do it invisibly, at the exact moment
// somebody renames an id in the shell. Throwing makes the shells' ids part of
// the contract, and scripts/test-ssr.mjs is what proves the contract holds
// before anything reaches a visitor.

/** Escape a value for a double-quoted HTML attribute. */
export const attr = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function elementRe(id) {
  // The opening tag carrying this id, its contents, and its closing tag.
  // Non-greedy, so it stops at the FIRST matching close tag — safe for these
  // shells because no target element nests another element of the same tag, and
  // the assertion below is what keeps that true.
  return new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`, 'i');
}

/** Replace the inner HTML of the element carrying `id`. Throws if absent. */
export function setInner(html, id, inner) {
  const re = elementRe(id);
  if (!re.test(html)) throw new Error(`shell: no element with id="${id}" to fill`);
  return html.replace(re, (_m, open, _tag, _old, close) => `${open}${inner}${close}`);
}

/**
 * Set (or replace) one attribute on the element carrying `id`. Throws if absent.
 *
 * Used for the two "back to the map" links, which are `href="#"` in the shell
 * because only the server knows the slug's real URL.
 */
export function setAttr(html, id, name, value) {
  const re = new RegExp(`(<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>)`, 'i');
  if (!re.test(html)) throw new Error(`shell: no element with id="${id}" to set ${name} on`);
  return html.replace(re, (open) => {
    const stripped = open.replace(new RegExp(`\\s${name}="[^"]*"`, 'i'), '');
    return stripped.replace(/>$/, ` ${name}="${attr(value)}">`);
  });
}

/**
 * Remove a bare boolean attribute (`hidden`) from the element carrying `id`.
 * A no-op when it is not there, because "already visible" is a legitimate state
 * — unlike a missing element, which is a broken shell.
 */
export function removeBooleanAttr(html, id, name) {
  const re = new RegExp(`(<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>)`, 'i');
  return html.replace(re, (open) => open.replace(new RegExp(`\\s${name}(?=[\\s>])`, 'i'), ''));
}

/** Replace the value of `class` on the element carrying `id`. Throws if absent. */
export function setClass(html, id, value) {
  return setAttr(html, id, 'class', value);
}
