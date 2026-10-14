export type WorkbookSheet = { name: string; rows: unknown[][] };

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const cellValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || value instanceof Date) return value ?? "";
  const cell = value as { result?: unknown; text?: unknown; richText?: { text?: unknown }[]; hyperlink?: unknown };
  if (cell.result !== undefined) return cellValue(cell.result);
  if (Array.isArray(cell.richText)) return cell.richText.map(part => String(part.text ?? "")).join("");
  if (cell.text !== undefined) return cell.text;
  if (cell.hyperlink !== undefined) return cell.text ?? "";
  return "";
};

/**
 * Reads only the cell values needed for local imports. Legacy .xls files are
 * intentionally rejected: their parser was the vulnerable SheetJS package.
 */
export async function readSafeWorkbook(file: File, allowCsv = true): Promise<WorkbookSheet[]> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_IMPORT_BYTES) throw new Error("보안을 위해 5MB 이하의 파일만 가져올 수 있습니다.");
  if (name.endsWith(".xls")) throw new Error("보안을 위해 기존 XLS 파일은 지원하지 않습니다. Excel에서 XLSX로 다시 저장해 가져와주세요.");
  if (!name.endsWith(".xlsx") && !(allowCsv && name.endsWith(".csv"))) {
    throw new Error(allowCsv ? "XLSX 또는 CSV 파일을 선택해주세요." : "XLSX 파일을 선택해주세요.");
  }

  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const content = await file.arrayBuffer();
  if (name.endsWith(".csv")) await workbook.csv.load(content as never);
  else await workbook.xlsx.load(content as never);

  return workbook.worksheets.map(sheet => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(cellValue));
    });
    return { name: sheet.name, rows };
  });
}
