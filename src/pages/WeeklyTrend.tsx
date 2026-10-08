import { loadClinicalReport } from '@/lib/clinicalReport';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { AppNavigation } from '@/components/AppNavigation';


import { Button } from '@/components/ui/button';
import { ContrastType, CONTRAST_LABELS, ShiftType, DailyData } from '@/types/contrast';
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  format,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  Users,
  Droplets,
} from 'lucide-react';


const CONTRAST_TYPES: ContrastType[] = ['jodascan300', 'hexopack350', 'gastrolux', 'mriContrast'];
const SHIFTS: ShiftType[] = ['morning', 'afternoon', 'night'];

const CHART_COLORS: Record<ContrastType, string> = {
  jodascan300: 'hsl(210, 80%, 55%)',
  hexopack350: 'hsl(150, 60%, 45%)',
  gastrolux: 'hsl(35, 85%, 55%)',
  mriContrast: 'hsl(280, 60%, 55%)',
};

interface DayAggregation {
  date: string;
  dayLabel: string;
  jodascan300Mls: number;
  hexopack350Mls: number;
  gastroluxMls: number;
  mriContrastMls: number;
  jodascan300Patients: number;
  hexopack350Patients: number;
  gastroluxPatients: number;
  mriContrastPatients: number;
  totalMls: number;
  totalPatients: number;
}

const WeeklyTrend = () => {


  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [rawRows, setRawRows] = useState<Pick<Tables<'daily_contrast_data'>,'date'|'data'>[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const weekEnd = useMemo(() => endOfWeek(currentWeekStart, { weekStartsOn: 0 }),[currentWeekStart]);
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  // Fetch data for the week
  useEffect(() => {
    const fetchWeekData = async () => {
      setIsLoading(true);
      const startStr = format(currentWeekStart, 'yyyy-MM-dd');
      const endStr = format(weekEnd, 'yyyy-MM-dd');

      const { data, error } = await loadClinicalReport(startStr, endStr);

      if (!error && data) {
        setRawRows(data);
      } else {
        setRawRows([]);
      }
      setIsLoading(false);
    };
    fetchWeekData();
  }, [currentWeekStart,weekEnd]);

  // Aggregate per day
  const dailyData: DayAggregation[] = useMemo(() => {
    return weekDays.map((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const row = rawRows.find((r) => r.date === dateStr);
      const dailyRecord = row?.data as unknown as DailyData | undefined;

      const agg: DayAggregation = {
        date: dateStr,
        dayLabel: format(day, 'EEE dd'),
        jodascan300Mls: 0,
        hexopack350Mls: 0,
        gastroluxMls: 0,
        mriContrastMls: 0,
        jodascan300Patients: 0,
        hexopack350Patients: 0,
        gastroluxPatients: 0,
        mriContrastPatients: 0,
        totalMls: 0,
        totalPatients: 0,
      };

      if (dailyRecord) {
        SHIFTS.forEach((shift) => {
          const shiftData = dailyRecord[shift];
          if (!shiftData) return;
          CONTRAST_TYPES.forEach((ct) => {
            const ctData = shiftData[ct];
            if (!ctData) return;
            const mls = Number(ctData.consumption?.mls || 0);
            const patients = Number(ctData.patients || 0);
            agg[`${ct}Mls` as `${ContrastType}Mls`] += mls;
            agg[`${ct}Patients` as `${ContrastType}Patients`] += patients;
            agg.totalMls += mls;
            agg.totalPatients += patients;
          });
        });
      }

      return agg;
    });
  }, [weekDays, rawRows]);

  // Weekly totals
  const weeklyTotals = useMemo(() => {
    const totals: Record<string, number> = { totalMls: 0, totalPatients: 0 };
    CONTRAST_TYPES.forEach((ct) => {
      totals[`${ct}Mls`] = 0;
      totals[`${ct}Patients`] = 0;
    });
    dailyData.forEach((day) => {
      CONTRAST_TYPES.forEach((ct) => {
        totals[`${ct}Mls`] += day[`${ct}Mls` as keyof DayAggregation] as number;
        totals[`${ct}Patients`] += day[`${ct}Patients` as keyof DayAggregation] as number;
      });
      totals.totalMls += day.totalMls;
      totals.totalPatients += day.totalPatients;
    });
    return totals;
  }, [dailyData]);

  const weekLabel = `${format(currentWeekStart, 'MMM dd')} — ${format(weekEnd, 'MMM dd, yyyy')}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <AppNavigation />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <h1 className="text-2xl font-bold">Clinical contrast trends</h1>
        {/* Week Selector */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <h2 className="text-lg font-semibold text-foreground">{weekLabel}</h2>
          <Button variant="outline" size="sm" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {CONTRAST_TYPES.map((ct) => (
                <div key={ct} className="dashboard-card p-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{CONTRAST_LABELS[ct]}</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-foreground">{weeklyTotals[`${ct}Mls`].toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">mls used</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-primary">{weeklyTotals[`${ct}Patients`]}</p>
                      <p className="text-xs text-muted-foreground">patients</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Grand Total Bar */}
            <div className="dashboard-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Weekly Total</p>
                  <p className="text-xl font-bold text-foreground">{weeklyTotals.totalMls.toLocaleString()} mls</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-muted-foreground">Total Patients</p>
                  <p className="text-xl font-bold text-foreground">{weeklyTotals.totalPatients}</p>
                </div>
              </div>
            </div>

            {/* Consumption Chart */}
            <div className="dashboard-card p-5 space-y-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Droplets className="h-4 w-4 text-primary" /> Daily Consumption (mls)
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="dayLabel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'oklch(var(--card))',
                      borderColor: 'oklch(var(--border))',
                      borderRadius: '8px',
                      color: 'oklch(var(--foreground))',
                    }}
                  />
                  <Legend />
                  {CONTRAST_TYPES.map((ct) => (
                    <Bar
                      key={ct}
                      dataKey={`${ct}Mls`}
                      name={CONTRAST_LABELS[ct]}
                      fill={CHART_COLORS[ct]}
                      stackId="consumption"
                      radius={ct === 'mriContrast' ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Patient Chart */}
            <div className="dashboard-card p-5 space-y-3">
              <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Daily Patient Count
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="dayLabel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'oklch(var(--card))',
                      borderColor: 'oklch(var(--border))',
                      borderRadius: '8px',
                      color: 'oklch(var(--foreground))',
                    }}
                  />
                  <Legend />
                  {CONTRAST_TYPES.map((ct) => (
                    <Line
                      key={ct}
                      type="monotone"
                      dataKey={`${ct}Patients`}
                      name={CONTRAST_LABELS[ct]}
                      stroke={CHART_COLORS[ct]}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Daily Breakdown Table */}
            <div className="dashboard-card overflow-hidden">
              <div className="p-4 border-b border-border">
                <h3 className="text-base font-semibold text-foreground">Daily Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left p-3 font-medium text-muted-foreground">Day</th>
                      {CONTRAST_TYPES.map((ct) => (
                        <th key={ct} className="text-center p-3 font-medium text-muted-foreground" colSpan={2}>
                          {CONTRAST_LABELS[ct]}
                        </th>
                      ))}
                      <th className="text-center p-3 font-medium text-muted-foreground" colSpan={2}>Total</th>
                    </tr>
                    <tr className="bg-muted/30 text-xs">
                      <th className="p-2" />
                      {CONTRAST_TYPES.map((ct) => (
                        <>
                          <th key={`${ct}-mls`} className="text-center p-2 text-muted-foreground">mls</th>
                          <th key={`${ct}-pts`} className="text-center p-2 text-muted-foreground">Patients</th>
                        </>
                      ))}
                      <th className="text-center p-2 text-muted-foreground">mls</th>
                      <th className="text-center p-2 text-muted-foreground">Patients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.map((day, idx) => (
                      <tr key={day.date} className={idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="p-3 font-medium text-foreground">{day.dayLabel}</td>
                        {CONTRAST_TYPES.map((ct) => (
                          <>
                            <td key={`${ct}-m`} className="text-center p-3 text-foreground">
                              {(day[`${ct}Mls` as keyof DayAggregation] as number).toLocaleString()}
                            </td>
                            <td key={`${ct}-p`} className="text-center p-3 text-primary font-medium">
                              {day[`${ct}Patients` as keyof DayAggregation] as number}
                            </td>
                          </>
                        ))}
                        <td className="text-center p-3 font-semibold text-foreground">{day.totalMls.toLocaleString()}</td>
                        <td className="text-center p-3 font-semibold text-primary">{day.totalPatients}</td>
                      </tr>
                    ))}
                    {/* Weekly Total Row */}
                    <tr className="bg-primary/10 font-bold border-t-2 border-primary/30">
                      <td className="p-3 text-foreground">Week Total</td>
                      {CONTRAST_TYPES.map((ct) => (
                        <>
                          <td key={`${ct}-tm`} className="text-center p-3 text-foreground">
                            {weeklyTotals[`${ct}Mls`].toLocaleString()}
                          </td>
                          <td key={`${ct}-tp`} className="text-center p-3 text-primary">
                            {weeklyTotals[`${ct}Patients`]}
                          </td>
                        </>
                      ))}
                      <td className="text-center p-3 text-foreground">{weeklyTotals.totalMls.toLocaleString()}</td>
                      <td className="text-center p-3 text-primary">{weeklyTotals.totalPatients}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default WeeklyTrend;
