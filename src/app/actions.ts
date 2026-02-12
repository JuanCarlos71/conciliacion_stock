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


const readFileFromBase64 = (base64: string, fileName: string): any[] => {
    if (!base64) return [];
    try {
        const workbook = XLSX.read(base64, { type: 'base64', cellDates: true, raw: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          throw new Error(`La hoja de cálculo '${sheetName}' no se encontró o está vacía.`);
        }
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });
        if (jsonData.length === 0) {
            throw new Error('El archivo no contiene datos o está en un formato incorrecto.');
        }
        return jsonData;
    } catch (error: any) {
        console.error(`Error reading ${fileName} file`, error);
        throw new Error(`No se pudo leer el archivo ${fileName}. Asegúrate que es un formato .xlsx válido. Detalle: ${error.message}`);
    }
};

export async function generateAnalysisFile(
  input: z.infer<typeof AnalysisInputSchema>
): Promise<z.infer<typeof AnalysisOutputSchema>> {

    const dataMap = new Map<string, any>();
    const skuToCentroMap = new Map<string, string>();
    const mermaByCentro = new Map<string, number>();
    const vencimientoByCentro = new Map<string, number>();

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
                descAlmacen: 'PT01'
            });
        }
    };

    // --- Process SAP Data ---
    try {
        const sapData = readFileFromBase64(input.sapFileB64, "SAP");
        
        const firstRow = sapData[0];
        if (!firstRow) {
            throw new Error('El archivo SAP está vacío o no tiene encabezados.');
        }

        const sapSkuHeader = findHeader(firstRow, SKU_SYNONYMS);
        const sapQtyHeader = findHeader(firstRow, QTY_SYNONYMS);
        const sapCentroHeader = findHeader(firstRow, CENTRO_SYNONYMS);
        const sapDescHeader = findHeader(firstRow, NOMBRE_PROD_SYNONYMS);
        const sapAreaSapHeader = findHeader(firstRow, WMS_AREA_SAP_SYNONYMS);

        if (!sapSkuHeader || !sapQtyHeader || !sapAreaSapHeader || !sapCentroHeader) {
            const missing = [
                !sapSkuHeader && 'SKU/Material',
                !sapQtyHeader && 'Cantidad/Stock',
                !sapAreaSapHeader && 'Almacén/AREA SAP',
                !sapCentroHeader && 'Centro'
            ].filter(Boolean).join(', ');
            throw new Error(`Columnas requeridas no encontradas en archivo SAP: ${missing}.`);
        }

        sapData.forEach((row, index) => {
             try {
                const areaSap = String(row[sapAreaSapHeader!] || '').trim().toUpperCase();
                if (areaSap !== 'PT01') return;

                const sku = String(row[sapSkuHeader] || '').trim();
                const qtyStr = String(row[sapQtyHeader] || '0').replace(/,/g, '');
                const qty = parseFloat(qtyStr);

                if (sku && !isNaN(qty)) {
                    ensureSku(sku);
                    const entry = dataMap.get(sku)!;
                    entry.sapQty += qty;

                    const centro = String(row[sapCentroHeader!] || '').trim();
                    if (centro && !skuToCentroMap.has(sku)) {
                        skuToCentroMap.set(sku, centro);
                    }

                    if (!entry.centro) entry.centro = centro;
                    if (!entry.nombreProd && sapDescHeader) entry.nombreProd = row[sapDescHeader];
                }
             } catch(e: any) {
                throw new Error(`Error en fila ${index + 2} del archivo SAP: ${e.message}`);
             }
        });
    } catch (e: any) {
        throw new Error(`[Paso 1: SAP] - ${e.message}`);
    }


    // --- Process WMS Data ---
    try {
        const wmsData = readFileFromBase64(input.wmsFileB64, "WMS");

        const firstRow = wmsData[0];
        if (!firstRow) {
            throw new Error('El archivo WMS está vacío o no tiene encabezados.');
        }

        const wmsSkuHeader = findHeader(firstRow, SKU_SYNONYMS);
        const wmsQtyHeader = findHeader(firstRow, QTY_SYNONYMS);
        const wmsAreaHeader = findHeader(firstRow, AREA_SYNONYMS);
        const wmsAreaSapHeader = findHeader(firstRow, WMS_AREA_SAP_SYNONYMS);
        const wmsUbicacionHeader = findHeader(firstRow, UBICACION_SYNONYMS);

        if (!wmsSkuHeader || !wmsQtyHeader || !wmsAreaHeader || !wmsUbicacionHeader || !wmsAreaSapHeader) {
             const missing = [
                !wmsSkuHeader && 'SKU/Material',
                !wmsQtyHeader && 'Cantidad',
                !wmsAreaHeader && 'Área',
                !wmsUbicacionHeader && 'Ubicación',
                !wmsAreaSapHeader && 'AREA SAP/Almacén'
            ].filter(Boolean).join(', ');
            throw new Error(`Columnas requeridas no encontradas en archivo WMS: ${missing}.`);
        }

        wmsData.forEach((row, index) => {
            try {
                const sku = String(row[wmsSkuHeader!] || '').trim();
                const qtyStr = String(row[wmsQtyHeader!] || '0').replace(/,/g, '');
                const qty = parseFloat(qtyStr);

                if (!sku || isNaN(qty)) return;

                ensureSku(sku);
                const entry = dataMap.get(sku)!;

                const areaSap = String(row[wmsAreaSapHeader!] || '').trim().toUpperCase();
                if (areaSap === 'PT01') {
                    entry.wmsQty += qty;
                }

                const area = String(row[wmsAreaHeader!] || '').trim().toUpperCase();
                const ubicacion = String(row[wmsUbicacionHeader!] || '').trim();
                if (area.startsWith("AREA STAGE") && ubicacion.startsWith("7")) {
                    entry.stockParaTraslado += qty;
                }
            } catch (e: any) {
                throw new Error(`Error en fila ${index + 2} del archivo WMS: ${e.message}`);
            }
        });
    } catch(e: any) {
        throw new Error(`[Paso 2: WMS] - ${e.message}`);
    }


    // --- Process Adjustments Data ---
    try {
        if (input.adjustmentsFileB64 && input.adjustmentsFileB64.length > 0) {
            const adjustmentsData = readFileFromBase64(input.adjustmentsFileB64, "Ajustes");
            if (adjustmentsData.length === 0) return;

            const firstRow = adjustmentsData[0];
            if (!firstRow) return; // Optional file can be empty

            const adjSkuHeader = findHeader(firstRow, SKU_SYNONYMS);
            const adjQtyHeader = findHeader(firstRow, QTY_SYNONYMS);
            const adjClaseMovHeader = findHeader(firstRow, CLASE_MOV_SYNONYMS);

            if (!adjSkuHeader || !adjQtyHeader || !adjClaseMovHeader) {
                const missing = [
                    !adjSkuHeader && 'SKU/Material',
                    !adjQtyHeader && 'Cantidad',
                    !adjClaseMovHeader && 'Clase de Movimiento',
                ].filter(Boolean).join(', ');
                console.warn(`Saltando archivo de ajustes por falta de columnas: ${missing}.`);
                return;
            }
            
            const difInvMovs = ['Z59', 'Z60', 'Z65', 'Z66'];
            adjustmentsData.forEach((row, index) => {
                try {
                    const sku = String(row[adjSkuHeader!] || '').trim();
                    const qtyStr = String(row[adjQtyHeader!] || '0').replace(/,/g, '');
                    const qty = parseFloat(qtyStr);
                    const claseMov = String(row[adjClaseMovHeader!] || '').trim().toUpperCase();

                    if (sku && !isNaN(qty) && claseMov) {
                        const centro = skuToCentroMap.get(sku) || 'INDEFINIDO';

                        if (difInvMovs.includes(claseMov)) {
                            ensureSku(sku);
                            dataMap.get(sku)!.adjustment += qty;
                        } else if (claseMov === 'Z42') {
                            mermaByCentro.set(centro, (mermaByCentro.get(centro) || 0) + qty);
                        } else if (claseMov === 'Z44') {
                            vencimientoByCentro.set(centro, (vencimientoByCentro.get(centro) || 0) + qty);
                        }
                    }
                } catch(e: any) {
                    throw new Error(`Error en fila ${index + 2} del archivo de Ajustes: ${e.message}`);
                }
            });
        }
    } catch(e: any) {
        throw new Error(`[Paso 3: Ajustes] - ${e.message}`);
    }


    // --- Final Report Generation ---
    let finalReport: any[] = [];
    try {
        finalReport = Array.from(dataMap.values()).map(entry => {
            if (!entry.centro) {
                entry.centro = skuToCentroMap.get(entry.sku) || 'INDEFINIDO';
            }
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
    } catch(e: any) {
        throw new Error(`[Paso 4: Reporte] - Error generando el reporte final: ${e.message}`);
    }
    

    // --- Create and return Excel file ---
    let outputBase64: string;
    let mermaReport: any[] = [];
    let vencimientoReport: any[] = [];
    try {
        const newWorkbook = XLSX.utils.book_new();
        
        const mainWorksheet = XLSX.utils.json_to_sheet(finalReport);
        XLSX.utils.book_append_sheet(newWorkbook, mainWorksheet, "Análisis de Stock");
        
        mermaReport = Array.from(mermaByCentro.entries()).map(([centro, cantidad]) => ({
            'Centro': centro,
            'Suma de Cantidad': cantidad
        }));
        if (mermaReport.length > 0) {
          const mermaWorksheet = XLSX.utils.json_to_sheet(mermaReport);
          XLSX.utils.book_append_sheet(newWorkbook, mermaWorksheet, "Merma (Z42)");
        }

        vencimientoReport = Array.from(vencimientoByCentro.entries()).map(([centro, cantidad]) => ({
            'Centro': centro,
            'Suma de Cantidad': cantidad
        }));
        if (vencimientoReport.length > 0) {
            const vencimientoWorksheet = XLSX.utils.json_to_sheet(vencimientoReport);
            XLSX.utils.book_append_sheet(newWorkbook, vencimientoWorksheet, "Vencimiento (Z44)");
        }

        outputBase64 = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'base64' });
    } catch(e: any) {
        throw new Error(`[Paso 5: Excel] - Error creando el archivo Excel de salida: ${e.message}`);
    }


    // --- Generate data for UI charts/tables ---
    let summaryChartData: any[] = [];
    let diferenciaReport: any[] = [];

    try {
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

        summaryChartData = Array.from(summaryByCentro.entries())
            .map(([name, value], index) => ({
                name,
                value: Math.abs(value),
                fill: chartColors[index % chartColors.length],
            }))
            .filter(item => item.value > 0);

        diferenciaReport = Array.from(summaryByCentro.entries())
            .map(([centro, diferencia]) => ({
                'Centro': centro,
                'Diferencia': diferencia,
            }))
            .filter(item => item.Diferencia !== 0);
        
    } catch (e: any) {
        throw new Error(`[Paso 6: UI Data] - Error preparando datos para la UI: ${e.message}`);
    }


    return {
        fileB64: outputBase64,
        analysisReport: finalReport,
        mermaReport,
        vencimientoReport,
        summaryChartData,
        diferenciaReport,
    };
}
