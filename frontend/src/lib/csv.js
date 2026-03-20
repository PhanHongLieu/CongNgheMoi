function escapeCsv(value) {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportRowsToCsv(fileName, columns, rows) {
  const header = columns.map((col) => escapeCsv(col.label)).join(",");
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const value = typeof col.value === "function" ? col.value(row) : row[col.key];
        return escapeCsv(value);
      })
      .join(",")
  );

  const csv = [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}
