export function isWorkBlockSchemaCacheError(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST204" ||
    (message.includes("schema cache") &&
      message.includes("work_blocks") &&
      message.includes("column"))
  );
}
