// Generated from the live `noren` Supabase project via the Supabase MCP
// `generate_typescript_types` tool. Regenerate after schema migrations,
// don't hand-edit.
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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      attempts: {
        Row: {
          answered_at: string
          hints_used: number
          id: string
          latency_ms: number | null
          line_id: string
          note: string | null
          seq: number
          session_id: string
          user_answer: string | null
          verdict: string | null
        }
        Insert: {
          answered_at?: string
          hints_used?: number
          id?: string
          latency_ms?: number | null
          line_id: string
          note?: string | null
          seq: number
          session_id: string
          user_answer?: string | null
          verdict?: string | null
        }
        Update: {
          answered_at?: string
          hints_used?: number
          id?: string
          latency_ms?: number | null
          line_id?: string
          note?: string | null
          seq?: number
          session_id?: string
          user_answer?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attempts_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "generated_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_dialogues: {
        Row: {
          created_at: string
          id: string
          level: string
          model: string
          prompt_version: string
          scenario_id: string
          setting: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level: string
          model: string
          prompt_version: string
          scenario_id: string
          setting?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          model?: string
          prompt_version?: string
          scenario_id?: string
          setting?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_dialogues_level_fkey"
            columns: ["level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_dialogues_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_dialogues_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "scenario_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_lines: {
        Row: {
          acceptable_en: Json
          audio_url: string | null
          dialogue_id: string
          en: string
          gist: string | null
          id: string
          ja: string
          kana: string | null
          key_en: string | null
          key_ja: string | null
          key_romaji: string | null
          romaji: string | null
          seq: number
          speaker: string
          tokens: Json
        }
        Insert: {
          acceptable_en?: Json
          audio_url?: string | null
          dialogue_id: string
          en: string
          gist?: string | null
          id?: string
          ja: string
          kana?: string | null
          key_en?: string | null
          key_ja?: string | null
          key_romaji?: string | null
          romaji?: string | null
          seq: number
          speaker: string
          tokens?: Json
        }
        Update: {
          acceptable_en?: Json
          audio_url?: string | null
          dialogue_id?: string
          en?: string
          gist?: string | null
          id?: string
          ja?: string
          kana?: string | null
          key_en?: string | null
          key_ja?: string | null
          key_romaji?: string | null
          romaji?: string | null
          seq?: number
          speaker?: string
          tokens?: Json
        }
        Relationships: [
          {
            foreignKeyName: "generated_lines_dialogue_id_fkey"
            columns: ["dialogue_id"]
            isOneToOne: false
            referencedRelation: "generated_dialogues"
            referencedColumns: ["id"]
          },
        ]
      }
      level_events: {
        Row: {
          accepted: boolean | null
          created_at: string
          from_level: string | null
          id: string
          reason: string
          to_level: string
          user_id: string
        }
        Insert: {
          accepted?: boolean | null
          created_at?: string
          from_level?: string | null
          id?: string
          reason: string
          to_level: string
          user_id: string
        }
        Update: {
          accepted?: boolean | null
          created_at?: string
          from_level?: string | null
          id?: string
          reason?: string
          to_level?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "level_events_from_level_fkey"
            columns: ["from_level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "level_events_to_level_fkey"
            columns: ["to_level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      level_state: {
        Row: {
          level: string
          manual_override: boolean
          sessions_at_level: number
          since: string
          user_id: string
        }
        Insert: {
          level: string
          manual_override?: boolean
          sessions_at_level?: number
          since?: string
          user_id: string
        }
        Update: {
          level?: string
          manual_override?: boolean
          sessions_at_level?: number
          since?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "level_state_level_fkey"
            columns: ["level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      levels: {
        Row: {
          example_dialogues: Json | null
          id: string
          label_en: string
          label_ja: string
          rate: number | null
          sort_order: number
          spec: string | null
        }
        Insert: {
          example_dialogues?: Json | null
          id: string
          label_en: string
          label_ja: string
          rate?: number | null
          sort_order: number
          spec?: string | null
        }
        Update: {
          example_dialogues?: Json | null
          id?: string
          label_en?: string
          label_ja?: string
          rate?: number | null
          sort_order?: number
          spec?: string | null
        }
        Relationships: []
      }
      lookups: {
        Row: {
          en: string | null
          id: string
          kana: string | null
          looked_up_at: string
          romaji: string | null
          session_id: string
          token_ja: string
          user_id: string
        }
        Insert: {
          en?: string | null
          id?: string
          kana?: string | null
          looked_up_at?: string
          romaji?: string | null
          session_id: string
          token_ja: string
          user_id: string
        }
        Update: {
          en?: string | null
          id?: string
          kana?: string | null
          looked_up_at?: string
          romaji?: string | null
          session_id?: string
          token_ja?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lookups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_level: string
          script_preference: string
          tts_vendor: string
          user_id: string
          voice_assignments: Json
        }
        Insert: {
          created_at?: string
          default_level?: string
          script_preference?: string
          tts_vendor?: string
          user_id: string
          voice_assignments?: Json
        }
        Update: {
          created_at?: string
          default_level?: string
          script_preference?: string
          tts_vendor?: string
          user_id?: string
          voice_assignments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "profiles_default_level_fkey"
            columns: ["default_level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_completion: {
        Row: {
          completed_at: string
          is_replay: boolean
          level: string
          scenario_id: string
          score: number | null
          user_id: string
          variant_id: string
        }
        Insert: {
          completed_at?: string
          is_replay?: boolean
          level: string
          scenario_id: string
          score?: number | null
          user_id: string
          variant_id: string
        }
        Update: {
          completed_at?: string
          is_replay?: boolean
          level?: string
          scenario_id?: string
          score?: number | null
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenario_completion_level_fkey"
            columns: ["level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenario_completion_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenario_completion_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "scenario_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_variants: {
        Row: {
          active: boolean
          description: string | null
          id: string
          scenario_id: string
        }
        Insert: {
          active?: boolean
          description?: string | null
          id?: string
          scenario_id: string
        }
        Update: {
          active?: boolean
          description?: string | null
          id?: string
          scenario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenario_variants_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          created_at: string
          id: string
          line_label: string | null
          name_en: string
          name_ja: string
          slug: string
          speaker_a: string
          speaker_b: string
        }
        Insert: {
          created_at?: string
          id?: string
          line_label?: string | null
          name_en: string
          name_ja: string
          slug: string
          speaker_a: string
          speaker_b: string
        }
        Update: {
          created_at?: string
          id?: string
          line_label?: string | null
          name_en?: string
          name_ja?: string
          slug?: string
          speaker_a?: string
          speaker_b?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          abandoned: boolean
          completed_at: string | null
          dialogue_id: string | null
          id: string
          is_replay: boolean
          level: string
          mode: string
          scenario_id: string
          started_at: string
          user_id: string
          variant_id: string
        }
        Insert: {
          abandoned?: boolean
          completed_at?: string | null
          dialogue_id?: string | null
          id?: string
          is_replay?: boolean
          level: string
          mode: string
          scenario_id: string
          started_at?: string
          user_id: string
          variant_id: string
        }
        Update: {
          abandoned?: boolean
          completed_at?: string | null
          dialogue_id?: string | null
          id?: string
          is_replay?: boolean
          level?: string
          mode?: string
          scenario_id?: string
          started_at?: string
          user_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_dialogue_id_fkey"
            columns: ["dialogue_id"]
            isOneToOne: false
            referencedRelation: "generated_dialogues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_level_fkey"
            columns: ["level"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "scenario_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      vocab_cards: {
        Row: {
          context_sentence_ja: string | null
          difficulty: number | null
          due_at: string
          en: string | null
          first_seen: string
          fsrs_state: Json | null
          id: string
          kana: string | null
          last_reviewed: string | null
          romaji: string | null
          source: string
          stability: number | null
          suspended: boolean
          times_looked_up: number
          times_missed: number
          token_ja: string
          user_id: string
        }
        Insert: {
          context_sentence_ja?: string | null
          difficulty?: number | null
          due_at?: string
          en?: string | null
          first_seen?: string
          fsrs_state?: Json | null
          id?: string
          kana?: string | null
          last_reviewed?: string | null
          romaji?: string | null
          source: string
          stability?: number | null
          suspended?: boolean
          times_looked_up?: number
          times_missed?: number
          token_ja: string
          user_id: string
        }
        Update: {
          context_sentence_ja?: string | null
          difficulty?: number | null
          due_at?: string
          en?: string | null
          first_seen?: string
          fsrs_state?: Json | null
          id?: string
          kana?: string | null
          last_reviewed?: string | null
          romaji?: string | null
          source?: string
          stability?: number | null
          suspended?: boolean
          times_looked_up?: number
          times_missed?: number
          token_ja?: string
          user_id?: string
        }
        Relationships: []
      }
      vocab_reviews: {
        Row: {
          card_id: string
          elapsed_days: number | null
          id: string
          rating: string
          reviewed_at: string
          scheduled_days: number | null
        }
        Insert: {
          card_id: string
          elapsed_days?: number | null
          id?: string
          rating: string
          reviewed_at?: string
          scheduled_days?: number | null
        }
        Update: {
          card_id?: string
          elapsed_days?: number | null
          id?: string
          rating?: string
          reviewed_at?: string
          scheduled_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vocab_reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "vocab_cards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
