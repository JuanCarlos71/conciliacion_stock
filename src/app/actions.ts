'use server';
/**
 * @fileOverview Flow to analyze stock files and generate a discrepancy report.
 *
 * - generateAnalysisFile: A function that takes SAP, WMS, and Adjustments files (Base64)
 *   and returns a new Excel file (Base64) with the analysis, plus JSON data for UI rendering.
 */
import { z } from 'zod';
import * as XLSX from 'xlsx';

// --- Input and Output Schemas ---
const AnalysisInputSchema = z.object({
  sapFileB64: z.string().describe('Base64 encoded SAP stock file'),
  wmsFileB64: z.string().describe('Base64 encoded WMS stock file'),
  adjustmentsFileB64: z
    .string()
    .optional()
    .describe('Optional Base64 encoded adjustments file'),
});

const AnalysisReportSchema = z.array(z.object({
    'Centro': z.string(),
    'Descripción (Almacén)': z.string(),
    'SKU': z.string(),
    'Nombre Prod': z.string(),
    'Stock SAP': z.number(),
    'Stock WMS': z.number(),
    'Diferencia': z.number(),
    'Ajuste Mensual (Dif. Inventario)': z.number(),
    'Stock para Traslado': z.number()
}));

const DetailReportSchema = z.array(z.object({
    'Centro': z.string(),
    'Suma de Cantidad': z.number()
}));

const DiferenciaReportSchema = z.array(z.object({
    'Centro': z.string(),
    'Diferencia': z.number()
}));


const SummaryChartDataSchema = z.array(z.object({
    name: z.string(),
    value: z.number(),
    fill: z.string(),
}));


const AnalysisOutputSchema = z.object({
  fileB64: z.string().describe("Base64 encoded string of the generated Excel file."),
  analysisReport: AnalysisReportSchema,
  mermaReport: DetailReportSchema,
  vencimientoReport: DetailReportSchema,
  summaryChartData: SummaryChartDataSchema,
  diferenciaReport: DiferenciaReportSchema,
});


// --- Helper Functions ---

// Synonyms for columns to allow for flexible file formats
const SKU_SYNONYMS = ['sku', 'material', 'código', 'codigo', 'cód', 'cod', 'item', 'producto', 'product id', 'artículo', 'articulo', 'referencia', 'ref', 'número de artículo', 'numero de articulo'];
const QTY_SYNONYMS = ['unrestrictedstock', 'libre utilización', 'ctd.en um entrada', 'quantity', 'unrestricted', 'cantidad', 'cant', 'stock', 'existencia', 'existencias', 'qty', 'on hand', 'disponible', 'stock sap', 'stock wms', 'ajuste', 'ajustes'];
const AREA_SYNONYMS = ['area', 'área']; 
const WMS_AREA_SAP_SYNONYMS = ['area sap', 'almacén', 'almacen', 'storage location'];
const UBICACION_SYNONYMS = ['ubicación', 'ubicacion', 'bin', 'location'];
const CENTRO_SYNONYMS = ['centro', 'center', 'plant'];
const NOMBRE_PROD_SYNONYMS = ['nombre prod', 'nombre producto', 'product name', 'descripción', 'descripcion', 'description', 'texto breve de material'];
const CLASE_MOV_SYNONYMS = ['clase de movimiento', 'clase mov', 'cl. mov.'];


const findHeader = (row: any, synonyms: string[]): string | undefined => {
  if (!row) return undefined;
  // Create a version of the keys that is standardized for matching
  const standardizedRowKeys = Object.keys(row).map(k => 
    k.toLowerCase().trim().replace(/\s+/g, ' ')
  );
  
  const cleanedSynonyms = synonyms.map(s => s.toLowerCase().trim().replace(/\s+/g, ' '));

  for (const synonym of cleanedSynonyms) {
    const foundKeyIndex = standardizedRowKeys.findIndex(key => key === synonym);
    if (foundKeyIndex !== -1) {
        // Return original case key
        return Object.keys(row)[foundKeyIndex];
    }
  }
   // Fallback for partial matches if no exact match is found
  for (const synonym of cleanedSynonyms) {
      const foundKeyIndex = standardizedRowKeys.findIndex(key => key.includes(synonym));
      if (foundKeyIndex !== -1) {
          return Object.keys(row)[foundKeyIndex];
      }
  }
  return undefined;
};


const readFileFromBase64 = (base64: string): any[] => {
    if (!base64) return [];
    try {
        const workbook = XLSX.read(base64, { type: 'base64', cellDates: true, raw: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        return XLSX.utils.sheet_to_json(worksheet, { raw: false });
    } catch (error) {
        console.error("Error reading base64 file", error);
        throw new Error("Could not parse one of the Excel files. Ensure they are valid .xlsx format.");
    }
};

export async function generateAnalysisFile(
  input: z.infer<typeof AnalysisInputSchema>
): Promise<z.infer<typeof AnalysisOutputSchema>> {
    const sapData = readFileFromBase64(input.sapFileB64);
    const wmsData = readFileFromBase64(input.wmsFileB64);
    const adjustmentsData = readFileFromBase64(input.adjustmentsFileB64 || '');

    if (sapData.length === 0 || wmsData.length === 0) {
      throw new Error('SAP or WMS file is empty or could not be read.');
    }

    // --- Header Identification ---
    const sapSkuHeader = findHeader(sapData[0], SKU_SYNONYMS);
    const sapQtyHeader = findHeader(sapData[0], QTY_SYNONYMS);
    const sapCentroHeader = findHeader(sapData[0], CENTRO_SYNONYMS);
    const sapDescHeader = findHeader(sapData[0], NOMBRE_PROD_SYNONYMS);
    const sapAreaSapHeader = findHeader(sapData[0], WMS_AREA_SAP_SYNONYMS); // For PT01 filtering in SAP

    const wmsSkuHeader = findHeader(wmsData[0], SKU_SYNONYMS);
    const wmsQtyHeader = findHeader(wmsData[0], QTY_SYNONYMS);
    const wmsAreaHeader = findHeader(wmsData[0], AREA_SYNONYMS);
    const wmsAreaSapHeader = findHeader(wmsData[0], WMS_AREA_SAP_SYNONYMS);
    const wmsUbicacionHeader = findHeader(wmsData[0], UBICACION_SYNONYMS);

    const adjSkuHeader = findHeader(adjustmentsData[0], SKU_SYNONYMS);
    const adjQtyHeader = findHeader(adjustmentsData[0], QTY_SYNONYMS);
    const adjClaseMovHeader = findHeader(adjustmentsData[0], CLASE_MOV_SYNONYMS);


    if (!sapSkuHeader || !sapQtyHeader) {
        throw new Error('Could not find required SKU or Quantity columns in SAP file.');
    }
    if (!sapAreaSapHeader) {
      throw new Error('Could not find "Almacén" column in SAP file, which is required for PT01 filtering.');
    }
     if (!sapCentroHeader) {
      throw new Error('Could not find "Centro" column in SAP file, which is required for grouping.');
    }
    if (!wmsSkuHeader || !wmsQtyHeader) {
      throw new Error('Could not find required SKU or Quantity columns in WMS file.');
    }
    if (!wmsAreaHeader || !wmsUbicacionHeader) {
        throw new Error('Could not find required "Área" or "Ubicación" columns in WMS file for "Stock para Traslado" calculation.');
    }
    if (!wmsAreaSapHeader) {
      throw new Error('Could not find "AREA SAP" or "Almacén" column in WMS file, which is required for PT01 filtering.');
    }

    // --- Data Aggregation ---
    // Create a mapping from SKU to Centro from the SAP data
    const skuToCentroMap = new Map<string, string>();
    if (sapSkuHeader && sapCentroHeader) {
        sapData.forEach(row => {
            const sku = String(row[sapSkuHeader!] || '').trim();
            const centro = String(row[sapCentroHeader!] || '').trim();
            if (sku && centro && !skuToCentroMap.has(sku)) {
                skuToCentroMap.set(sku, centro);
            }
        });
    }

    const dataMap = new Map<string, any>();
    const mermaByCentro = new Map<string, number>(); // For Z42, grouped by Centro
    const vencimientoByCentro = new Map<string, number>(); // For Z44, grouped by Centro


    // Helper to initialize data for a SKU
    const ensureSku = (sku: string) => {
        if (!dataMap.has(sku)) {
            dataMap.set(sku, {
                sku,
                sapQty: 0,
                wmsQty: 0,
                adjustment: 0,
                stockParaTraslado: 0,
                centro: '',
                nombreProd: '',
                descAlmacen: 'PT01' // We are filtering by PT01, so this is constant
            });
        }
    };
    
     // Process SAP
    sapData.forEach(row => {
        const areaSap = String(row[sapAreaSapHeader!] || '').trim().toUpperCase();
        if (areaSap !== 'PT01') {
            return; // Skip if not PT01
        }

        const sku = String(row[sapSkuHeader] || '').trim();
        const qty = parseFloat(String(row[sapQtyHeader]).replace(/,/g, ''));
        if (sku && !isNaN(qty)) {
            ensureSku(sku);
            const entry = dataMap.get(sku)!;
            entry.sapQty += qty;
            
            if (!entry.centro && sapCentroHeader) entry.centro = row[sapCentroHeader];
            if (!entry.nombreProd && sapDescHeader) entry.nombreProd = row[sapDescHeader];
        }
    });

    // Process WMS
    wmsData.forEach(row => {
        const sku = String(row[wmsSkuHeader!] || '').trim();
        const qty = parseFloat(String(row[wmsQtyHeader!]).replace(/,/g, ''));

        if (!sku || isNaN(qty)) {
            return; // Skip rows without SKU or valid quantity
        }

        ensureSku(sku);
        const entry = dataMap.get(sku)!;

        // Condition for main WMS stock (in PT01 warehouse)
        const areaSap = String(row[wmsAreaSapHeader!] || '').trim().toUpperCase();
        if (areaSap === 'PT01') {
            entry.wmsQty += qty;
        }

        // Condition for "Stock para Traslado"
        const area = String(row[wmsAreaHeader!] || '').trim().toUpperCase();
        const ubicacion = String(row[wmsUbicacionHeader!] || '').trim();
        if (area.startsWith("AREA STAGE") && ubicacion.startsWith("7")) {
            entry.stockParaTraslado += qty;
        }
    });


    // Process Adjustments
    if (adjSkuHeader && adjQtyHeader && adjClaseMovHeader) {
      const difInvMovs = ['Z59', 'Z60', 'Z65', 'Z66'];
      
      adjustmentsData.forEach(row => {
          const sku = String(row[adjSkuHeader!] || '').trim();
          const qty = parseFloat(String(row[adjQtyHeader!]).replace(/,/g, ''));
          const claseMov = String(row[adjClaseMovHeader!] || '').trim().toUpperCase();

          if (sku && !isNaN(qty) && claseMov) {
               const centro = skuToCentroMap.get(sku) || 'INDEFINIDO';

              if (difInvMovs.includes(claseMov)) {
                  ensureSku(sku);
                  dataMap.get(sku)!.adjustment += qty;
              } else if (claseMov === 'Z42') {
                  mermaByCentro.set(centro, (mermaByCentro.get(centro) || 0) + qty);
              } else if (claseMov === 'Z44') { // Corresponds to "Vencimiento" from image, not Z45
                  vencimientoByCentro.set(centro, (vencimientoByCentro.get(centro) || 0) + qty);
              }
          }
      });
    }
    
    // --- Final Report Generation ---
    const finalReport = Array.from(dataMap.values()).map(entry => {
        return {
            'Centro': entry.centro,
            'Descripción (Almacén)': entry.descAlmacen,
            'SKU': entry.sku,
            'Nombre Prod': entry.nombreProd,
            'Stock SAP': entry.sapQty,
            'Stock WMS': entry.wmsQty,
            'Diferencia': entry.wmsQty - entry.sapQty,
            'Ajuste Mensual (Dif. Inventario)': entry.adjustment,
            'Stock para Traslado': entry.stockParaTraslado
        };
    }).filter(entry => entry['Stock SAP'] !== 0 || entry['Stock WMS'] !== 0 || entry['Ajuste Mensual (Dif. Inventario)'] !== 0);

    // --- Create and return Excel file ---
    const newWorkbook = XLSX.utils.book_new();
    
    // Main analysis sheet
    const mainWorksheet = XLSX.utils.json_to_sheet(finalReport);
    XLSX.utils.book_append_sheet(newWorkbook, mainWorksheet, "Análisis de Stock");
    
    // Merma sheet
    const mermaReport = Array.from(mermaByCentro.entries()).map(([centro, cantidad]) => ({
        'Centro': centro,
        'Suma de Cantidad': cantidad
    }));
    if (mermaReport.length > 0) {
      const mermaWorksheet = XLSX.utils.json_to_sheet(mermaReport);
      XLSX.utils.book_append_sheet(newWorkbook, mermaWorksheet, "Merma (Z42)");
    }

    // Vencimiento sheet
    const vencimientoReport = Array.from(vencimientoByCentro.entries()).map(([centro, cantidad]) => ({
        'Centro': centro,
        'Suma de Cantidad': cantidad
    }));
    if (vencimientoReport.length > 0) {
        const vencimientoWorksheet = XLSX.utils.json_to_sheet(vencimientoReport);
        XLSX.utils.book_append_sheet(newWorkbook, vencimientoWorksheet, "Vencimiento (Z44)");
    }

    const outputBase64 = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'base64' });

    // --- Generate data for UI charts/tables ---
    
    // Aggregate adjustments by 'Centro' for the summary table
    const summaryByCentro = new Map<string, number>();
    finalReport.forEach(item => {
        const centro = item['Centro'] || 'INDEFINIDO';
        const ajuste = item['Ajuste Mensual (Dif. Inventario)'];
        summaryByCentro.set(centro, (summaryByCentro.get(centro) || 0) + ajuste);
    });

    const chartColors = [
        'var(--color-chart-1)',
        'var(--color-chart-2)',
        'var(--color-chart-3)',
        'var(--color-chart-4)',
        'var(--color-chart-5)',
    ];

    const summaryChartData = Array.from(summaryByCentro.entries())
        .map(([name, value], index) => ({
            name,
            value: Math.abs(value), // Use absolute value for pie chart size
            fill: chartColors[index % chartColors.length],
        }))
        .filter(item => item.value > 0); // Only show centers with differences

    const diferenciaReport = Array.from(summaryByCentro.entries())
        .map(([centro, diferencia]) => ({
            'Centro': centro,
            'Diferencia': diferencia,
        }))
        .filter(item => item.Diferencia !== 0);


    return {
        fileB64: outputBase64,
        analysisReport: finalReport,
        mermaReport,
        vencimientoReport,
        summaryChartData,
        diferenciaReport,
    };
}
