export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clinical_stock_transitions: {
        Row: {date:string;original_data:Json;imported_at:string}
        Insert: never
        Update: never
        Relationships: []
      }
      room_shift_reviews: {
        Row: {date:string;room:string;shift:string;details:Json;physical:Json;note:string;staff:string;stock_token:string;finished:boolean;version:number;updated_at:string}
        Insert: never
        Update: never
        Relationships: []
      }
      contrast_usage_logs: {
        Row: {
          contrast_type: string
          created_at: string
          date: string
          id: string
          modality: string
          patient_number: string
          shift: string
          updated_at: string
          volume_ml: number
        }
        Insert: {
          contrast_type: string
          created_at?: string
          date: string
          id?: string
          modality: string
          patient_number: string
          shift?: string
          updated_at?: string
          volume_ml?: number
        }
        Update: {
          contrast_type?: string
          created_at?: string
          date?: string
          id?: string
          modality?: string
          patient_number?: string
          shift?: string
          updated_at?: string
          volume_ml?: number
        }
        Relationships: []
      }
      daily_contrast_data: {
        Row: {
          created_at: string
          data: Json
          date: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          data?: Json
          date: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          data?: Json
          date?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: { id: string; name: string; unit: string; balance: number; active: boolean; opening_recorded: boolean }
        Insert: { id: string; name: string; unit: string; balance?: number; active?: boolean; opening_recorded?: boolean }
        Update: { id?: string; name?: string; unit?: string; balance?: number; active?: boolean; opening_recorded?: boolean }
        Relationships: []
      }
      stock_movements: {
        Row: {
          id: string; batch_id: string; item_id: string; movement_type: string;
          quantity: number; balance_after: number; occurred_on: string; recipient_name: string;
          destination: string | null; picked_for: string | null; reference: string | null;
          recorded_by: string; created_at: string; balance_known: boolean; shift: string | null; version: number; voided_at: string | null
        }
        Insert: {
          id?: string; batch_id: string; item_id: string; movement_type: string;
          quantity: number; balance_after: number; occurred_on: string; recipient_name: string;
          destination?: string | null; reference?: string | null;
          recorded_by: string; created_at?: string
        }
        Update: {
          id?: string; batch_id?: string; item_id?: string; movement_type?: string;
          quantity?: number; balance_after?: number; occurred_on?: string; recipient_name?: string;
          destination?: string | null; reference?: string | null;
          recorded_by?: string; created_at?: string
        }
        Relationships: [{ foreignKeyName: "stock_movements_item_id_fkey"; columns: ["item_id"]; isOneToOne: false; referencedRelation: "stock_items"; referencedColumns: ["id"] }]
      }
      room_stock: {
        Row: { room: string; item_id: string; balance: number; counted_on: string | null; counted_at: string | null }
        Insert: { room: string; item_id: string; balance?: number; counted_on?: string | null; counted_at?: string | null }
        Update: { balance?: number; counted_on?: string | null; counted_at?: string | null }
        Relationships: []
      }
      stock_shift_usage: {
        Row: { date: string; room: string; shift: string; category: string; quantities: Json; contrast_volumes: Json; patients: number; version: number; recorded_by_name: string; updated_at: string }
        Insert: { date: string; room: string; shift: string; category: string; quantities?: Json; patients?: number; version?: number; recorded_by_name: string; updated_at?: string }
        Update: { quantities?: Json; patients?: number; version?: number; recorded_by_name?: string; updated_at?: string }
        Relationships: []
      }
      room_stock_movements: {
        Row: { id: string; batch_id: string; room: string; item_id: string; movement_type: string; change: number; balance_after: number; balance_known: boolean; occurred_on: string; shift: string | null; staff_name: string; recorded_by: string; created_at: string; version: number; voided_at: string | null; usage_room: string | null }
        Insert: { room: string; item_id: string; movement_type: string; change: number; balance_after: number; balance_known: boolean; occurred_on: string; shift?: string | null; staff_name: string; recorded_by: string; batch_id: string }
        Update: { change?: number }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      shift_context: {Args:{p_date:string;p_room:string;p_shift:string};Returns:Json}
      save_shift: {Args:{p_date:string;p_room:string;p_shift:string;p_details:Json;p_staff:string;p_version:number;p_film_version:number;p_supply_version:number;p_finish:boolean;p_physical:Json;p_note:string;p_token:string};Returns:number}
      inventory_permissions: { Args: Record<string, never>; Returns: Json }
      set_stock_staff: { Args: { p_email: string; p_active: boolean }; Returns: undefined }
      edit_stock_receipt: { Args: { p_id: string; p_version: number; p_quantity: number; p_date: string; p_recipient: string; p_reference?: string | null; p_delete?: boolean }; Returns: number }
      correct_pick_room: { Args: { p_store_id: string; p_version: number; p_room: string; p_reason: string }; Returns: number }
      correct_stock_movement: { Args: { p_source: string; p_id: string; p_version: number; p_quantity: number; p_date: string; p_staff: string; p_reference: string | null; p_reason: string; p_delete?: boolean }; Returns: number }
      stock_audit_history: { Args: { p_start: string; p_end: string; p_offset?: number; p_limit?: number }; Returns: Json }
      move_room_stock_units: {
        Args: { p_type: string; p_date: string; p_staff: string; p_lines: Json; p_room?: string | null; p_shift?: string | null; p_reference?: string | null; p_request?: string | null }
        Returns: string
      }
      save_room_usage_units: {
        Args: { p_date: string; p_room: string; p_shift: string; p_category: string; p_quantities: Json; p_patients: number; p_staff: string; p_version: number; p_volumes: Json }
        Returns: number
      }
      move_room_stock_volume: {
        Args: { p_type: string; p_date: string; p_staff: string; p_lines: Json; p_room?: string | null; p_shift?: string | null; p_reference?: string | null; p_request?: string | null }
        Returns: string
      }
      save_room_usage_volume: {
        Args: { p_date: string; p_room: string; p_shift: string; p_category: string; p_quantities: Json; p_patients: number; p_staff: string; p_version: number; p_volumes: Json }
        Returns: number
      }
      move_room_stock: {
        Args: { p_type: string; p_date: string; p_staff: string; p_lines: Json; p_room?: string | null; p_shift?: string | null; p_reference?: string | null; p_request?: string | null }
        Returns: string
      }
      save_room_usage: {
        Args: { p_date: string; p_room: string; p_shift: string; p_category: string; p_quantities: Json; p_patients: number; p_staff: string; p_version: number }
        Returns: number
      }
      record_stock_batch: {
        Args: {
          p_type: string; p_date: string; p_recipient: string; p_lines: Json;
          p_destination?: string | null; p_reference?: string | null
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
