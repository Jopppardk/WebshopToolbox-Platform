export type MonthComparison = { month: number; current: number | null; previous: number | null };
export type PerformanceMetric = { months: MonthComparison[]; error?: string };
export type PerformanceFinance = {
  year: number; checkedAt: string; startDate: string; currency: 'DKK';
  revenue: PerformanceMetric; expenses: PerformanceMetric;
  suppliers: Array<{ id: string; name: string; months: MonthComparison[] }>;
  unassigned: MonthComparison[];
};
export type PerformanceShop = {
  year: number; checkedAt: string; startDate: string; timezone: string;
  visits: PerformanceMetric; orders: PerformanceMetric;
};
export const performanceMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
