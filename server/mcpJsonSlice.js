/**
 * Lets an MCP client read a large JSON payload in full, a piece at a time.
 *
 * Dashboard payloads run from a few KB to several MB. Returning them whole
 * would blow an agent's context; truncating them silently would hide rows. So
 * a payload that fits is returned as is, and one that does not comes back as
 * an outline (every key, every array length) plus the exact `path`, `offset`
 * and `limit` to ask for next. Nothing is ever dropped without saying so.
 */

const DEFAULT_MAX_CHARS = 150_000;
const DEFAULT_LIMIT = 100;

export function selectPath(value, path) {
  if (!path) return { found: true, value };
  let current = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/u.test(part)) {
      current = current[Number(part)];
    } else if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
    } else {
      return { found: false, value: undefined };
    }
    if (current === undefined) return { found: false, value: undefined };
  }
  return { found: true, value: current };
}

/** A compact map of a value: object keys with their kinds, array lengths and one sample item's shape. */
export function outline(value, depth = 3) {
  if (Array.isArray(value)) {
    return {
      _array: value.length,
      ...(value.length && depth > 0 ? { _item: outline(value[0], depth - 1) } : {}),
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (depth <= 0) return { _object: entries.length };
    const out = {};
    for (const [key, item] of entries) {
      if (item === null || typeof item !== "object") {
        const text = JSON.stringify(item);
        out[key] = text && text.length > 80 ? text.slice(0, 77) + "…" : item;
      } else {
        out[key] = outline(item, depth - 1);
      }
    }
    return out;
  }
  return value;
}

const size = (value) => JSON.stringify(value)?.length ?? 0;

export function sliceJson(payload, request = {}) {
  const path = (request.path ?? "").trim();
  const maxChars = Math.max(10_000, Math.min(request.maxChars ?? DEFAULT_MAX_CHARS, 400_000));
  const selected = selectPath(payload, path);
  if (!selected.found) {
    return {
      path,
      kind: "missing",
      hint: "Nothing at this path. The outline shows the keys that exist.",
      outlineOnly: true,
      data: outline(payload, 2),
    };
  }
  const value = selected.value;

  if (Array.isArray(value)) {
    const offset = Math.max(0, Math.floor(request.offset ?? 0));
    let limit = Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT));
    let items = value.slice(offset, offset + limit);
    // Shrink the page until it fits, rather than cutting an item in half.
    while (items.length > 1 && size(items) > maxChars) {
      limit = Math.max(1, Math.floor(limit / 2));
      items = value.slice(offset, offset + limit);
    }
    if (size(items) > maxChars) {
      return {
        path,
        kind: "array",
        total: value.length,
        offset,
        returned: 0,
        outlineOnly: true,
        hint: `One item is too large. Read it by path, e.g. "${path ? path + "." : ""}${offset}".`,
        data: outline(items[0], 3),
      };
    }
    const next = offset + items.length;
    return {
      path,
      kind: "array",
      total: value.length,
      offset,
      returned: items.length,
      ...(next < value.length ? { nextOffset: next } : {}),
      data: items,
    };
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).length;
    if (size(value) <= maxChars) return { path, kind: "object", total: keys, data: value };
    return {
      path,
      kind: "object",
      total: keys,
      outlineOnly: true,
      hint: "Too large to return at once. Read each part with path, e.g. path=\"<key>\"; arrays page with offset and limit.",
      data: outline(value, 3),
    };
  }

  return { path, kind: "value", data: value };
}

/** Shared JSON-schema properties for the paging arguments, so every app describes them the same way. */
export const SLICE_INPUT_PROPERTIES = {
  path: {
    type: "string",
    description:
      "Optional dot path into the response, e.g. \"rows\" or \"campaigns.0.ads\". Use it when the first answer returns an outline.",
  },
  offset: { type: "integer", minimum: 0, description: "First item when the value at path is a list. Defaults to 0." },
  limit: { type: "integer", minimum: 1, maximum: 1000, description: "Items per page for lists. Defaults to 100." },
};
