export interface ProviderPrice { symbol: string; date: string; close: number; source: string; }
export interface PriceSource { readonly name: string; fetch(symbol: string, startDate?: string): Promise<ProviderPrice[]>; }
