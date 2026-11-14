import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {Json} from '@/integrations/supabase/types';
import { 
  DailyData, 
  ShiftType, 
  ContrastType, 
  ContrastValues,
  createEmptyDailyData 
} from '@/types/contrast';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { clinicalDateKey, recalculateClinicalDay, carryClinicalDay } from '@/lib/clinicalContinuity';

import { clinicalBottleCapacity, convertContrast } from '@/lib/contrastVolume';

export const useContrastData = () => {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [data, setData] = useState<DailyData>(() => {
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    return createEmptyDailyData(dateStr);
  });
  const [isLoading, setIsLoading] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSave=useRef(0);
  const [saveFeedback,setSaveFeedback]=useState({date:'',status:'idle',error:''});
  const { toast } = useToast();

  const dateKey = clinicalDateKey(selectedDate);
  const [hasRecord, setHasRecord] = useState(false);
  const [carriedFrom, setCarriedFrom] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [loadingError, setLoadingError] = useState('');

  // Load data from database
  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setIsLoading(true);
      setLoadingError('');
      try {
        const { data: row, error } = await supabase
          .from('daily_contrast_data')
          .select('data')
          .eq('date', dateKey)
          .maybeSingle();

        if (cancelled) return;
        const transitions = await supabase.from('clinical_stock_transitions').select('date').lte('date',dateKey).order('date',{ascending:false}).limit(1);
        if (cancelled) return;
        if (transitions.error) throw transitions.error;
        setConnected(!!transitions.data?.length);
        setHasRecord(!!row?.data);
        setCarriedFrom(null);
        if (error) {
          setLoadingError('The saved record could not load. Do not re-enter it; reload or contact support.');
          console.error('Error loading data:', error);
          toast({ title: 'Error loading data', description: 'Unable to load data. Please try again or contact support.', variant: 'destructive' });
          setData(createEmptyDailyData(dateKey));
        } else if (row?.data) {
          setData(recalculateClinicalDay(row.data as unknown as DailyData));
        } else {
          const previousDate = new Date(selectedDate);
          previousDate.setDate(previousDate.getDate() - 1);
          const previousKey = clinicalDateKey(previousDate);
          const previous = await supabase.from('daily_contrast_data').select('data').eq('date', previousKey).maybeSingle();
          if (cancelled) return;
          if (previous.error) throw previous.error;
          if (previous.data?.data && !transitions.data?.length) {
            setData(carryClinicalDay(previous.data.data as unknown as DailyData, createEmptyDailyData(dateKey)));
            setCarriedFrom(previousKey);
          } else setData(createEmptyDailyData(dateKey));
        }
      } catch (err) {
        console.error('Error loading data:', err);
        if (!cancelled) setLoadingError('The saved record could not load. Check that the recovery database update has been applied, then reload.');
        if (!cancelled) setData(createEmptyDailyData(dateKey));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [dateKey, toast]);

  // Debounced save to database
  const saveToDatabase = useCallback((newData: DailyData) => {
    const attempt=++latestSave.current;
    setSaveFeedback({date:dateKey,status:'pending',error:''});
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if(attempt===latestSave.current)setSaveFeedback({date:dateKey,status:'saving',error:''});
      try {
        const { error } = await supabase
          .from('daily_contrast_data')
          .upsert(
            { date: dateKey, data: newData as unknown as Json },
            { onConflict: 'date' }
          );

        if (error) {
          if(attempt===latestSave.current)setSaveFeedback({date:dateKey,status:'error',error:`Could not confirm automatic save: ${error.message}. Keep this page open and check the saved record before entering it again.`});
          console.error('Error saving data:', error);
          toast({ title: 'Error saving data', description: 'Unable to save data. Please try again or contact support.', variant: 'destructive' });
        } else if(attempt===latestSave.current)setSaveFeedback({date:dateKey,status:'saved',error:''});
      } catch (err) {
        if(attempt===latestSave.current)setSaveFeedback({date:dateKey,status:'error',error:`Could not confirm automatic save: ${err instanceof Error?err.message:'connection interrupted'}. Keep this page open and check the saved record before entering it again.`});
        console.error('Error saving data:', err);
      }
    }, 500);
  }, [dateKey, toast]);
  useEffect(()=>{
    if(!['pending','saving','error'].includes(saveFeedback.status))return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[saveFeedback.status]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Calculate outstanding stock
  const calculateOutstanding = useCallback((received: ContrastValues, consumption: ContrastValues): ContrastValues => {
    return {
      mls: Math.round((received.mls - consumption.mls) * 10) / 10,
      bottles: Math.round((received.bottles - consumption.bottles) * 10) / 10,
    };
  }, []);

  // Helper to update and save
  const updateAndSave = useCallback((updater: (prev: DailyData) => DailyData) => {
    setData(prev => {
      const newData = recalculateClinicalDay(updater(prev));
      saveToDatabase(newData);
      return newData;
    });
  }, [saveToDatabase]);

  // Validate numeric input
  const validateValue = useCallback((value: number, field: 'mls' | 'bottles'): number | null => {
    if (!Number.isFinite(value)) return null;
    const max = field === 'mls' ? 100000 : 1000;
    if (value < 0 || value > max) {
      toast({
        title: 'Invalid value',
        description: `Value must be between 0 and ${max.toLocaleString()}`,
        variant: 'destructive',
      });
      return null;
    }
    return value;
  }, [toast]);

  // Update received values (only for morning shift)
  const updateReceived = useCallback((
    shift: ShiftType,
    contrastType: ContrastType,
    field: 'mls' | 'bottles',
    value: number
  ) => {
    if (shift !== 'morning') return;
    const validated = validateValue(value, field);
    if (validated === null) return;

    updateAndSave(prev => {
      const newData = { ...prev };
      const shiftData = { ...newData[shift] };
      const contrastData = { ...shiftData[contrastType] };
      if (clinicalBottleCapacity(contrastType) > 0) {
        const converted = convertContrast(contrastType, field, value);
        contrastData.received = { ...contrastData.received, ...converted };
      } else {
        contrastData.received = { ...contrastData.received, [field]: value };
      }
      const totalReceived = {
        mls: contrastData.received.mls + (contrastData.additionalReceived?.mls || 0),
        bottles: contrastData.received.bottles + (contrastData.additionalReceived?.bottles || 0),
      };
      contrastData.outstanding = calculateOutstanding(totalReceived, contrastData.consumption);
      shiftData[contrastType] = contrastData;
      newData[shift] = shiftData;
      return newData;
    });
  }, [calculateOutstanding, updateAndSave, validateValue]);

  // Update additional received values (for afternoon/night shifts)
  const updateAdditionalReceived = useCallback((
    shift: ShiftType,
    contrastType: ContrastType,
    field: 'mls' | 'bottles',
    value: number
  ) => {
    if (shift === 'morning') return;
    const validated = validateValue(value, field);
    if (validated === null) return;

    updateAndSave(prev => {
      const newData = { ...prev };
      const shiftData = { ...newData[shift] };
      const contrastData = { ...shiftData[contrastType] };
      if (clinicalBottleCapacity(contrastType) > 0) {
        const converted = convertContrast(contrastType, field, value);
        contrastData.additionalReceived = { ...(contrastData.additionalReceived || { mls: 0, bottles: 0 }), ...converted };
      } else {
        contrastData.additionalReceived = { ...(contrastData.additionalReceived || { mls: 0, bottles: 0 }), [field]: value };
      }

      let carriedOver: ContrastValues;
      if (shift === 'afternoon') {
        carriedOver = newData.morning[contrastType].outstanding;
      } else {
        carriedOver = newData.afternoon[contrastType].outstanding;
      }

      const additionalFinal = contrastData.additionalReceived;
      const totalReceivedFinal = {
        mls: carriedOver.mls + additionalFinal.mls,
        bottles: carriedOver.bottles + additionalFinal.bottles,
      };
      contrastData.outstanding = calculateOutstanding(totalReceivedFinal, contrastData.consumption);
      shiftData[contrastType] = contrastData;
      newData[shift] = shiftData;
      return newData;
    });
  }, [calculateOutstanding, updateAndSave, validateValue]);

  // Update consumption values
  const updateConsumption = useCallback((
    shift: ShiftType,
    contrastType: ContrastType,
    field: 'mls' | 'bottles',
    value: number
  ) => {
    const validated = validateValue(value, field);
    if (validated === null) return;
    updateAndSave(prev => {
      const newData = { ...prev };
      const shiftData = { ...newData[shift] };
      const contrastData = { ...shiftData[contrastType] };
      if (clinicalBottleCapacity(contrastType) > 0) {
        const converted = convertContrast(contrastType, field, value);
        contrastData.consumption = { ...contrastData.consumption, ...converted };
      } else {
        contrastData.consumption = { ...contrastData.consumption, [field]: value };
      }
      
      let receivedValues = contrastData.received;
      if (shift === 'afternoon') {
        receivedValues = newData.morning[contrastType].outstanding;
      } else if (shift === 'night') {
        receivedValues = newData.afternoon[contrastType].outstanding;
      }

      const additional = contrastData.additionalReceived || { mls: 0, bottles: 0 };
      const totalReceived = shift === 'morning' ? receivedValues : {
        mls: receivedValues.mls + additional.mls,
        bottles: receivedValues.bottles + additional.bottles,
      };
      
      contrastData.outstanding = calculateOutstanding(totalReceived, contrastData.consumption);
      shiftData[contrastType] = contrastData;
      newData[shift] = shiftData;
      return newData;
    });
  }, [calculateOutstanding, updateAndSave, validateValue]);

  // Get carried-over values for a shift (from previous shift outstanding)
  const getCarriedOverValues = useCallback((shift: ShiftType, contrastType: ContrastType): ContrastValues => {
    if (shift === 'morning') {
      return data.morning[contrastType].received;
    } else if (shift === 'afternoon') {
      return data.morning[contrastType].outstanding;
    } else {
      return data.afternoon[contrastType].outstanding;
    }
  }, [data]);

  // Get total received values for a shift (carried over + additional)
  const getReceivedValues = useCallback((shift: ShiftType, contrastType: ContrastType): ContrastValues => {
    const carriedOver = getCarriedOverValues(shift, contrastType);
    if (shift === 'morning') return carriedOver;
    const additional = data[shift][contrastType].additionalReceived || { mls: 0, bottles: 0 };
    return {
      mls: carriedOver.mls + additional.mls,
      bottles: carriedOver.bottles + additional.bottles,
    };
  }, [data, getCarriedOverValues]);

  // Get additional received values for a shift
  const getAdditionalReceivedValues = useCallback((shift: ShiftType, contrastType: ContrastType): ContrastValues => {
    return data[shift][contrastType].additionalReceived || { mls: 0, bottles: 0 };
  }, [data]);

  // Get outstanding values for a shift
  const getOutstandingValues = useCallback((shift: ShiftType, contrastType: ContrastType): ContrastValues => {
    const received = getReceivedValues(shift, contrastType);
    const consumption = data[shift][contrastType].consumption;
    return calculateOutstanding(received, consumption);
  }, [data, getReceivedValues, calculateOutstanding]);

  // Update metadata
  const updateMetadata = useCallback((
    shift: ShiftType,
    field: 'handedOverTo' | 'calculatedBy' | 'attestation',
    value: string | boolean
  ) => {
    updateAndSave(prev => {
      const newData = { ...prev };
      const shiftData = { ...newData[shift] };
      shiftData.metadata = { ...shiftData.metadata, [field]: value };
      newData[shift] = shiftData;
      return newData;
    });
  }, [updateAndSave]);

  // Update patient count
  const updatePatients = useCallback((
    shift: ShiftType,
    contrastType: ContrastType,
    value: number
  ) => {
    if (!Number.isFinite(value) || value < 0 || value > 10000) return;
    updateAndSave(prev => {
      const newData = { ...prev };
      const shiftData = { ...newData[shift] };
      const contrastData = { ...shiftData[contrastType] };
      contrastData.patients = value;
      shiftData[contrastType] = contrastData;
      newData[shift] = shiftData;
      return newData;
    });
  }, [updateAndSave]);

  // Reset form
  const resetForm = useCallback(() => {
    const emptyData = createEmptyDailyData(dateKey);
    setData(emptyData);
    saveToDatabase(emptyData);
  }, [dateKey, saveToDatabase]);

  return {
    selectedDate,
    setSelectedDate,
    data,
    isLoading,
    updateReceived,
    updateAdditionalReceived,
    updateConsumption,
    updatePatients,
    getReceivedValues,
    getAdditionalReceivedValues,
    getOutstandingValues,
    updateMetadata,
    resetForm,
    hasRecord,
    carriedFrom,
    connected,
    loadingError,
    saveFeedback,
  };
};

