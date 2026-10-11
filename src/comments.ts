interface CommentSource {
  name: string;
  description?: string;
  inline?: string;
  comment?: string;
  original?: string;
  comments?: string[];
}
/** Preserve every source comment, including repeated text and built-in explanations. */
export function lineComments(info: CommentSource): string[] {
  const comments = info.comments ?? [info.original, info.comment ?? info.inline];
  return comments.filter((comment): comment is string => Boolean(comment?.trim()));
}
