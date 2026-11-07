/** Cuts at a code unit limit without leaving half an emoji behind (F29). */
export const cut = (text: string, limit: number) => (text.length > limit && /[\uD800-\uDBFF]/.test(text[limit - 1]!) ? text.slice(0, limit - 1) : text.slice(0, limit));
/** `start`, moved forward off the second half of a surrogate pair. */
export const charStart = (text: string, start: number) => (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? '') && /[\uD800-\uDBFF]/.test(text[start - 1]!) ? start + 1 : start);
