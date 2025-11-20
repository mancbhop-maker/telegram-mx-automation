/**
 * Google Apps Script web app to receive POSTs from the Telegram webhook server.
 * - Expects JSON: { barcode: "...", status: "Найдено"/"Не найдено", user: "Фамилия" }
 * - Scans ALL sheets in the spreadsheet, but only updates rows where column G == "Проверить на МХ"
 * - Compares barcode against column B
 * - Writes Status -> column G, User -> column I
 *
 * After copying this script to your Google Apps Script project, deploy as 'Web app' (Execute as: Me, Who has access: Anyone)
 */

const SPREADSHEET_ID = 'ВАШ_ID_ТАБЛИЦЫ'; // <-- замените перед деплоем или храните в PropertiesService

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const barcode = String(body.barcode || '').trim();
    const status = String(body.status || '').trim();
    const user = String(body.user || '').trim();

    if (!barcode || !status) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'no barcode or status' })).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    let updated = 0;

    sheets.forEach(sheet => {
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return; // no rows
      // find column indexes: B -> 1, G -> 6, I -> 8 (0-based here)
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const barcodeCell = String(row[1] || '').trim();
        const statusCell = String(row[6] || '').trim(); // G
        if (!barcodeCell) continue;
        if (barcodeCell === barcode && statusCell === 'Проверить на МХ') {
          // update G and I (columns 7 and 9)
          sheet.getRange(i+1, 7).setValue(status);
          sheet.getRange(i+1, 9).setValue(user);
          updated++;
          // don't break: there may be same barcode on other sheets
        }
      }
    });

    return ContentService.createTextOutput(JSON.stringify({ ok: true, updated })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
