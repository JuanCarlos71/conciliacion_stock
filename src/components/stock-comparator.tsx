'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';
import * as XLSX from 'xlsx';


type FormData = {
  sapFile: FileList;
  wmsFile: FileList;
  adjustmentsFile: FileList | null;
};

type AnalysisResult = {
  analysisReport: any[];
  mermaReport: Array<{ Centro: string; 'Suma de Cantidad': number }>;
  vencimientoReport: Array<{ Centro: string; 'Suma de Cantidad': number }>;
  summaryChartData: Array<{ name: string; value: number; fill: string }>;
  diferenciaReport: Array<{ Centro: string; 'Diferencia': number }>;
};


// --- Helper Functions ---

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
  const standardizedRowKeys = Object.keys(row).map(k =>
    k.toLowerCase().trim().replace(/\s+/g, ' ')
  );
  const cleanedSynonyms = synonyms.map(s => s.toLowerCase().trim().replace(/\s+/g, ' '));
  for (const synonym of cleanedSynonyms) {
    const foundKeyIndex = standardizedRowKeys.findIndex(key => key === synonym);
    if (foundKeyIndex !== -1) {
        return Object.keys(row)[foundKeyIndex];
    }
  }
  for (const synonym of cleanedSynonyms) {
      const foundKeyIndex = standardizedRowKeys.findIndex(key => key.includes(synonym));
      if (foundKeyIndex !== -1) {
          return Object.keys(row)[foundKeyIndex];
      }
  }
  return undefined;
};

const readFile = async (file: File, fileName: string): Promise<any[]> => {
    if (!file) return [];
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, raw: false });
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


export function StockComparator() {
  const form = useForm<FormData>();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);

  async function onSubmit(values: FormData) {
    setIsLoading(true);
    setAnalysisResult(null);

    if (!values.sapFile?.[0] || !values.wmsFile?.[0]) {
      toast({
        variant: 'destructive',
        title: 'Archivos Faltantes',
        description: 'Por favor, sube los archivos de SAP y WMS.',
      });
      setIsLoading(false);
      return;
    }

    try {
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
        setProgressMessage('[Paso 1/6] - Leyendo archivo SAP...');
        const sapData = await readFile(values.sapFile[0], "SAP");
        
        setProgressMessage('[Paso 2/6] - Procesando datos de SAP...');
        const firstRowSap = sapData[0];
        if (!firstRowSap) throw new Error('El archivo SAP está vacío o no tiene encabezados.');

        const sapSkuHeader = findHeader(firstRowSap, SKU_SYNONYMS);
        const sapQtyHeader = findHeader(firstRowSap, QTY_SYNONYMS);
        const sapCentroHeader = findHeader(firstRowSap, CENTRO_SYNONYMS);
        const sapDescHeader = findHeader(firstRowSap, NOMBRE_PROD_SYNONYMS);
        const sapAreaSapHeader = findHeader(firstRowSap, WMS_AREA_SAP_SYNONYMS);

        if (!sapSkuHeader || !sapQtyHeader || !sapAreaSapHeader || !sapCentroHeader) {
            const missing = [!sapSkuHeader && 'SKU/Material', !sapQtyHeader && 'Cantidad/Stock', !sapAreaSapHeader && 'Almacén/AREA SAP', !sapCentroHeader && 'Centro'].filter(Boolean).join(', ');
            throw new Error(`Columnas requeridas no encontradas en archivo SAP: ${missing}.`);
        }

        sapData.forEach((row) => {
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
                if (centro && !skuToCentroMap.has(sku)) skuToCentroMap.set(sku, centro);
                if (!entry.centro) entry.centro = centro;
                if (!entry.nombreProd && sapDescHeader) entry.nombreProd = row[sapDescHeader];
            }
        });

        // --- Process WMS Data ---
        setProgressMessage('[Paso 3/6] - Leyendo y procesando archivo WMS...');
        const wmsData = await readFile(values.wmsFile[0], "WMS");

        const firstRowWms = wmsData[0];
        if (!firstRowWms) throw new Error('El archivo WMS está vacío o no tiene encabezados.');

        const wmsSkuHeader = findHeader(firstRowWms, SKU_SYNONYMS);
        const wmsQtyHeader = findHeader(firstRowWms, QTY_SYNONYMS);
        const wmsAreaHeader = findHeader(firstRowWms, AREA_SYNONYMS);
        const wmsAreaSapHeader = findHeader(firstRowWms, WMS_AREA_SAP_SYNONYMS);
        const wmsUbicacionHeader = findHeader(firstRowWms, UBICACION_SYNONYMS);

        if (!wmsSkuHeader || !wmsQtyHeader || !wmsAreaHeader || !wmsUbicacionHeader || !wmsAreaSapHeader) {
            const missing = [!wmsSkuHeader && 'SKU/Material', !wmsQtyHeader && 'Cantidad', !wmsAreaHeader && 'Área', !wmsUbicacionHeader && 'Ubicación', !wmsAreaSapHeader && 'AREA SAP/Almacén'].filter(Boolean).join(', ');
            throw new Error(`Columnas requeridas no encontradas en archivo WMS: ${missing}.`);
        }

        wmsData.forEach((row) => {
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
        });

        // --- Process Adjustments Data ---
        if (values.adjustmentsFile?.[0]) {
            setProgressMessage('[Paso 4/6] - Leyendo y procesando archivo de Ajustes...');
            const adjustmentsData = await readFile(values.adjustmentsFile[0], "Ajustes");
            const firstRowAdj = adjustmentsData[0];
            if (firstRowAdj) {
                const adjSkuHeader = findHeader(firstRowAdj, SKU_SYNONYMS);
                const adjQtyHeader = findHeader(firstRowAdj, QTY_SYNONYMS);
                const adjClaseMovHeader = findHeader(firstRowAdj, CLASE_MOV_SYNONYMS);

                if (adjSkuHeader && adjQtyHeader && adjClaseMovHeader) {
                    const difInvMovs = ['Z59', 'Z60', 'Z65', 'Z66'];
                    adjustmentsData.forEach((row) => {
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
                    });
                }
            }
        }
        
        // --- Final Report Generation ---
        setProgressMessage('[Paso 5/6] - Compilando reporte final...');
        const finalReport = Array.from(dataMap.values()).map(entry => {
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

        const mermaReport = Array.from(mermaByCentro.entries()).map(([centro, cantidad]) => ({ 'Centro': centro, 'Suma de Cantidad': cantidad }));
        const vencimientoReport = Array.from(vencimientoByCentro.entries()).map(([centro, cantidad]) => ({ 'Centro': centro, 'Suma de Cantidad': cantidad }));
        
        const summaryByCentro = new Map<string, number>();
        finalReport.forEach(item => {
            const centro = item['Centro'] || 'INDEFINIDO';
            const ajuste = item['Ajuste Mensual (Dif. Inventario)'];
            summaryByCentro.set(centro, (summaryByCentro.get(centro) || 0) + ajuste);
        });

        const chartColors = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)'];
        const summaryChartData = Array.from(summaryByCentro.entries()).map(([name, value], index) => ({ name, value: Math.abs(value), fill: chartColors[index % chartColors.length] })).filter(item => item.value > 0);
        const diferenciaReport = Array.from(summaryByCentro.entries()).map(([centro, diferencia]) => ({ 'Centro': centro, 'Diferencia': diferencia })).filter(item => item.Diferencia !== 0);

        setAnalysisResult({ analysisReport: finalReport, mermaReport, vencimientoReport, summaryChartData, diferenciaReport });
        
        // --- Create and download Excel file ---
        setProgressMessage('[Paso 6/6] - Creando archivo Excel para descarga...');
        const newWorkbook = XLSX.utils.book_new();
        const mainWorksheet = XLSX.utils.json_to_sheet(finalReport);
        XLSX.utils.book_append_sheet(newWorkbook, mainWorksheet, "Análisis de Stock");
        if (mermaReport.length > 0) {
          const mermaWorksheet = XLSX.utils.json_to_sheet(mermaReport);
          XLSX.utils.book_append_sheet(newWorkbook, mermaWorksheet, "Merma (Z42)");
        }
        if (vencimientoReport.length > 0) {
            const vencimientoWorksheet = XLSX.utils.json_to_sheet(vencimientoReport);
            XLSX.utils.book_append_sheet(newWorkbook, vencimientoWorksheet, "Vencimiento (Z44)");
        }

        const outputBase64 = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'base64' });
        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${outputBase64}`;
        link.download = 'analisis_stock.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
          title: 'Análisis Completado',
          description: 'El reporte se ha generado en pantalla y el archivo ha sido descargado.',
        });
        setProgressMessage(null);

    } catch (error: any) {
      console.error(error);
      const errorMessage = error.message || 'Ocurrió un problema al procesar los archivos.';
      setProgressMessage(`Error: ${errorMessage}`);
      toast({
        variant: 'destructive',
        title: 'Error en el Análisis',
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Cargar Archivos de Stock</CardTitle>
          <CardDescription>
            Sube los archivos de SAP, WMS y Ajustes para generar el reporte de
            discrepancias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="sapFile"
                render={() => (
                  <FormItem>
                    <FormLabel>Archivo de Stock SAP</FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept=".xlsx"
                        {...form.register('sapFile', {
                          required: 'Este archivo es obligatorio.',
                        })}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="wmsFile"
                render={() => (
                  <FormItem>
                    <FormLabel>Archivo de Stock WMS</FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept=".xlsx"
                        {...form.register('wmsFile', {
                          required: 'Este archivo es obligatorio.',
                        })}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="adjustmentsFile"
                render={() => (
                  <FormItem>
                    <FormLabel>Archivo de Ajustes (Opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept=".xlsx"
                        {...form.register('adjustmentsFile')}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Analizando...
                  </>
                ) : (
                  'Analizar y Descargar'
                )}
              </Button>
               {isLoading && progressMessage && (
                <p className="text-center text-sm text-muted-foreground pt-4">{progressMessage}</p>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
      
      {analysisResult && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card>
                <CardHeader>
                    <CardTitle>Resumen de Diferencias por Centro</CardTitle>
                    <CardDescription>Total de diferencias de inventario por centro.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-72">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Centro</TableHead>
                                    <TableHead className="text-right">Diferencia</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analysisResult.diferenciaReport.length > 0 ? analysisResult.diferenciaReport.map(item => (
                                    <TableRow key={item.Centro}>
                                        <TableCell>{item.Centro}</TableCell>
                                        <TableCell className="text-right">{item.Diferencia}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="h-24 text-center">No hay datos</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Ajustes por Merma (Z42) por Centro</CardTitle>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-72">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Centro</TableHead>
                                    <TableHead className="text-right">Cantidad</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analysisResult.mermaReport.length > 0 ? analysisResult.mermaReport.map(item => (
                                    <TableRow key={item.Centro}>
                                        <TableCell>{item.Centro}</TableCell>
                                        <TableCell className="text-right">{item['Suma de Cantidad']}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="h-24 text-center">No hay datos</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Ajustes por Vencimiento (Z44) por Centro</CardTitle>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-72">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Centro</TableHead>
                                    <TableHead className="text-right">Cantidad</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {analysisResult.vencimientoReport.length > 0 ? analysisResult.vencimientoReport.map(item => (
                                    <TableRow key={item.Centro}>
                                        <TableCell>{item.Centro}</TableCell>
                                        <TableCell className="text-right">{item['Suma de Cantidad']}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="h-24 text-center">No hay datos</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      )}
    </div>
  );
}
