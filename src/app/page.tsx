import Image from "next/image";
import { Package } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { StockComparator } from "@/components/stock-comparator";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-10 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Package className="h-6 w-6 text-primary" />
            <span className="ml-2 font-bold text-lg">Stock Comparator</span>
          </div>
          <span className="font-semibold text-lg">Inventario CD8000</span>
        </div>
      </header>
      <main className="container flex-grow py-8 flex items-center justify-center">
        <StockComparator />
      </main>
      <footer className="py-6 md:px-8 md:py-0">
        <div className="container flex flex-col items-center justify-center gap-4 md:h-24 md:flex-row">
            <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
                An AI-powered supply chain tool.
            </p>
        </div>
      </footer>
      <Toaster />
    </div>
  );
}
