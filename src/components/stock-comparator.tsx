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
import { generateAnalysisFile } from '@/ai/flows/generate-analysis-file';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';


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


const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URI prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

export function StockComparator() {
  const form = useForm<FormData>();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

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
      const [sapFileB64, wmsFileB64, adjustmentsFileB64] = await Promise.all([
        fileToBase64(values.sapFile[0]),
        fileToBase64(values.wmsFile[0]),
        values.adjustmentsFile?.[0]
          ? fileToBase64(values.adjustmentsFile[0])
          : Promise.resolve(''),
      ]);

      const result = await generateAnalysisFile({
        sapFileB64,
        wmsFileB64,
        adjustmentsFileB64,
      });

      if (result && result.fileB64) {
        setAnalysisResult(result);

        const link = document.createElement('a');
        link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.fileB64}`;
        link.download = 'analisis_stock.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({
          title: 'Análisis Completado',
          description: 'El reporte se ha generado en pantalla y el archivo ha sido descargado.',
        });
      } else {
        throw new Error('El análisis no generó un archivo.');
      }
    } catch (error: any) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'Error en el Análisis',
        description:
          error.message ||
          'Ocurrió un problema al procesar los archivos.',
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
