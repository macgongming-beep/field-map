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
      app_users: {
        Row: {
          approval_status: string
          created_at: string | null
          id: number
          is_active: boolean
          last_login_at: string | null
          login_id: string
          name: string
          phone: string | null
          pin: string
          role: string
        }
        Insert: {
          approval_status?: string
          created_at?: string | null
          id?: number
          is_active?: boolean
          last_login_at?: string | null
          login_id: string
          name: string
          phone?: string | null
          pin: string
          role?: string
        }
        Update: {
          approval_status?: string
          created_at?: string | null
          id?: number
          is_active?: boolean
          last_login_at?: string | null
          login_id?: string
          name?: string
          phone?: string | null
          pin?: string
          role?: string
        }
        Relationships: []
      }
      app_users_backup_20260430: {
        Row: {
          created_at: string | null
          id: number | null
          last_login_at: string | null
          login_id: string | null
          name: string | null
          phone: string | null
          pin: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number | null
          last_login_at?: string | null
          login_id?: string | null
          name?: string | null
          phone?: string | null
          pin?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number | null
          last_login_at?: string | null
          login_id?: string | null
          name?: string | null
          phone?: string | null
          pin?: string | null
          role?: string | null
        }
        Relationships: []
      }
      auth_sessions: {
        Row: {
          created_at: string
          device_label: string | null
          expires_at: string
          last_used_at: string
          token: string
          user_agent: string | null
          user_id: number
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          expires_at?: string
          last_used_at?: string
          token?: string
          user_agent?: string | null
          user_id: number
        }
        Update: {
          created_at?: string
          device_label?: string | null
          expires_at?: string
          last_used_at?: string
          token?: string
          user_agent?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "auth_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      buildings: {
        Row: {
          access_status: string
          address: string
          card_id: number
          created_at: string | null
          id: number
          is_chinese_heavy: boolean
          lat: number
          lng: number
          memo: string | null
          name: string
          type: string
          warning: boolean | null
        }
        Insert: {
          access_status?: string
          address: string
          card_id: number
          created_at?: string | null
          id?: number
          is_chinese_heavy?: boolean
          lat: number
          lng: number
          memo?: string | null
          name: string
          type: string
          warning?: boolean | null
        }
        Update: {
          access_status?: string
          address?: string
          card_id?: number
          created_at?: string | null
          id?: number
          is_chinese_heavy?: boolean
          lat?: number
          lng?: number
          memo?: string | null
          name?: string
          type?: string
          warning?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "buildings_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      building_access_events: {
        Row: {
          action: string
          building_id: number
          created_at: string
          id: number
          memo: string | null
          source_visit_history_id: number | null
          time_slot: string | null
          visited_at: string
          visitor_name: string
        }
        Insert: {
          action: string
          building_id: number
          created_at?: string
          id?: number
          memo?: string | null
          source_visit_history_id?: number | null
          time_slot?: string | null
          visited_at?: string
          visitor_name: string
        }
        Update: {
          action?: string
          building_id?: number
          created_at?: string
          id?: number
          memo?: string | null
          source_visit_history_id?: number | null
          time_slot?: string | null
          visited_at?: string
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "building_access_events_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          allow_applications: boolean
          card_name: string
          created_at: string | null
          event_date: string
          has_meeting: boolean
          id: number
          leader_name: string
          meeting_map_url: string | null
          memo: string
          place: string
          series_id: string | null
          time: string
          title: string
          type: string
        }
        Insert: {
          allow_applications?: boolean
          card_name?: string
          created_at?: string | null
          event_date: string
          has_meeting?: boolean
          id?: number
          leader_name?: string
          meeting_map_url?: string | null
          memo?: string
          place?: string
          series_id?: string | null
          time?: string
          title: string
          type?: string
        }
        Update: {
          allow_applications?: boolean
          card_name?: string
          created_at?: string | null
          event_date?: string
          has_meeting?: boolean
          id?: number
          leader_name?: string
          meeting_map_url?: string | null
          memo?: string
          place?: string
          series_id?: string | null
          time?: string
          title?: string
          type?: string
        }
        Relationships: []
      }
      card_assignments: {
        Row: {
          card_id: number
          created_at: string | null
          id: number
          user_name: string
        }
        Insert: {
          card_id: number
          created_at?: string | null
          id?: number
          user_name: string
        }
        Update: {
          card_id?: number
          created_at?: string | null
          id?: number
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_assignments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_boundaries: {
        Row: {
          card_id: number
          points: Json
          updated_at: string | null
        }
        Insert: {
          card_id: number
          points: Json
          updated_at?: string | null
        }
        Update: {
          card_id?: number
          points?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_boundaries_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: true
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      card_leader_assignments: {
        Row: {
          card_id: number
          created_at: string | null
          id: number
          user_name: string
        }
        Insert: {
          card_id: number
          created_at?: string | null
          id?: number
          user_name: string
        }
        Update: {
          card_id?: number
          created_at?: string | null
          id?: number
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_leader_assignments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      cards: {
        Row: {
          area: string
          created_at: string | null
          id: number
          leader_name: string | null
          name: string
          region: string
          status: string
          type: string
        }
        Insert: {
          area: string
          created_at?: string | null
          id?: number
          leader_name?: string | null
          name: string
          region: string
          status?: string
          type: string
        }
        Update: {
          area?: string
          created_at?: string | null
          id?: number
          leader_name?: string | null
          name?: string
          region?: string
          status?: string
          type?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          author_id: number | null
          author_name: string
          content: string | null
          created_at: string
          deleted_at: string | null
          event_id: number
          id: number
          image_expired: boolean
          image_expires_at: string | null
          image_url: string | null
          mention_ids: number[]
          mention_names: string[]
          message_type: string
        }
        Insert: {
          author_id?: number | null
          author_name: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id: number
          id?: number
          image_expired?: boolean
          image_expires_at?: string | null
          image_url?: string | null
          mention_ids?: number[]
          mention_names?: string[]
          message_type?: string
        }
        Update: {
          author_id?: number | null
          author_name?: string
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          event_id?: number
          id?: number
          image_expired?: boolean
          image_expires_at?: string | null
          image_url?: string | null
          mention_ids?: number[]
          mention_names?: string[]
          message_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_read_status: {
        Row: {
          event_id: number
          last_read_at: string
          user_id: number
        }
        Insert: {
          event_id: number
          last_read_at?: string
          user_id: number
        }
        Update: {
          event_id?: number
          last_read_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_read_status_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_read_status_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_room_mutes: {
        Row: {
          event_id: number
          muted_at: string
          user_id: number
        }
        Insert: {
          event_id: number
          muted_at?: string
          user_id: number
        }
        Update: {
          event_id?: number
          muted_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_room_mutes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_room_mutes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: number | null
          author_name: string
          content: string
          created_at: string
          deleted_at: string | null
          id: number
          mention_ids: number[]
          mention_names: string[]
          target_id: number
          target_type: string
          updated_at: string
        }
        Insert: {
          author_id?: number | null
          author_name: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: number
          mention_ids?: number[]
          mention_names?: string[]
          target_id: number
          target_type: string
          updated_at?: string
        }
        Update: {
          author_id?: number | null
          author_name?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: number
          mention_ids?: number[]
          mention_names?: string[]
          target_id?: number
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_card_assignment_cards: {
        Row: {
          card_id: number
          created_at: string | null
          event_id: number
          id: number
          user_name: string
        }
        Insert: {
          card_id: number
          created_at?: string | null
          event_id: number
          id?: number
          user_name: string
        }
        Update: {
          card_id?: number
          created_at?: string | null
          event_id?: number
          id?: number
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_card_assignment_cards_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_card_assignment_cards_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_card_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string
          assigned_card_id: number
          event_id: number
          id: number
          memo: string
          user_name: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string
          assigned_card_id: number
          event_id: number
          id?: number
          memo?: string
          user_name: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string
          assigned_card_id?: number
          event_id?: number
          id?: number
          memo?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_card_assignments_assigned_card_id_fkey"
            columns: ["assigned_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_card_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_participants: {
        Row: {
          created_at: string | null
          event_id: number
          id: number
          role: string
          user_name: string
        }
        Insert: {
          created_at?: string | null
          event_id: number
          id?: number
          role: string
          user_name: string
        }
        Update: {
          created_at?: string | null
          event_id?: number
          id?: number
          role?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
        ]
      }
      login_logs: {
        Row: {
          id: number
          logged_in_at: string
          user_id: number | null
        }
        Insert: {
          id?: never
          logged_in_at?: string
          user_id?: number | null
        }
        Update: {
          id?: never
          logged_in_at?: string
          user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "login_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          author: string
          content: string
          created_at: string
          id: number
          priority: string
          title: string
        }
        Insert: {
          author?: string
          content?: string
          created_at?: string
          id?: never
          priority?: string
          title: string
        }
        Update: {
          author?: string
          content?: string
          created_at?: string
          id?: never
          priority?: string
          title?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          push_chat: boolean
          push_comment: boolean
          push_event_change: boolean
          push_mention: boolean
          push_new_notice: boolean
          push_service_status: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          updated_at: string
          user_id: number
        }
        Insert: {
          push_chat?: boolean
          push_comment?: boolean
          push_event_change?: boolean
          push_mention?: boolean
          push_new_notice?: boolean
          push_service_status?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id: number
        }
        Update: {
          push_chat?: boolean
          push_comment?: boolean
          push_event_change?: boolean
          push_mention?: boolean
          push_new_notice?: boolean
          push_service_status?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          updated_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: number
          is_read: boolean
          link: string | null
          related_id: number | null
          title: string
          type: string
          user_id: number
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: number
          is_read?: boolean
          link?: string | null
          related_id?: number | null
          title: string
          type: string
          user_id: number
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: number
          is_read?: boolean
          link?: string | null
          related_id?: number | null
          title?: string
          type?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: number
          last_seen_at: string | null
          p256dh: string
          updated_at: string
          user_id: number
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: number
          last_seen_at?: string | null
          p256dh: string
          updated_at?: string
          user_id: number
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: number
          last_seen_at?: string | null
          p256dh?: string
          updated_at?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      regular_visits: {
        Row: {
          id: number
          registered_at: string | null
          unit_id: number
          visitor_name: string
        }
        Insert: {
          id?: number
          registered_at?: string | null
          unit_id: number
          visitor_name: string
        }
        Update: {
          id?: number
          registered_at?: string | null
          unit_id?: number
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "regular_visits_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: true
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      return_visit_logs: {
        Row: {
          created_at: string | null
          created_by: string | null
          created_by_user_id: number | null
          id: number
          invalidated_at: string | null
          invalidated_by_user_id: number | null
          invalidation_reason: string | null
          memo: string | null
          result: string | null
          return_visit_id: number | null
          service_session_id: number | null
          updated_at: string | null
          updated_by_user_id: number | null
          visited_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          created_by_user_id?: number | null
          id?: number
          invalidated_at?: string | null
          invalidated_by_user_id?: number | null
          invalidation_reason?: string | null
          memo?: string | null
          result?: string | null
          return_visit_id?: number | null
          service_session_id?: number | null
          updated_at?: string | null
          updated_by_user_id?: number | null
          visited_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          created_by_user_id?: number | null
          id?: number
          invalidated_at?: string | null
          invalidated_by_user_id?: number | null
          invalidation_reason?: string | null
          memo?: string | null
          result?: string | null
          return_visit_id?: number | null
          service_session_id?: number | null
          updated_at?: string | null
          updated_by_user_id?: number | null
          visited_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_visit_logs_return_visit_id_fkey"
            columns: ["return_visit_id"]
            isOneToOne: false
            referencedRelation: "return_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      return_visits: {
        Row: {
          address: string | null
          assigned_user_name: string | null
          building_id: number | null
          created_at: string | null
          created_by: string | null
          display_name: string
          end_reason: string | null
          ended_at: string | null
          ended_by_name: string | null
          id: number
          last_result: string | null
          last_visited_at: string | null
          nickname: string | null
          unit_id: number | null
          unit_number: string | null
        }
        Insert: {
          address?: string | null
          assigned_user_name?: string | null
          building_id?: number | null
          created_at?: string | null
          created_by?: string | null
          display_name: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by_name?: string | null
          id?: number
          last_result?: string | null
          last_visited_at?: string | null
          nickname?: string | null
          unit_id?: number | null
          unit_number?: string | null
        }
        Update: {
          address?: string | null
          assigned_user_name?: string | null
          building_id?: number | null
          created_at?: string | null
          created_by?: string | null
          display_name?: string
          end_reason?: string | null
          ended_at?: string | null
          ended_by_name?: string | null
          id?: number
          last_result?: string | null
          last_visited_at?: string | null
          nickname?: string | null
          unit_id?: number | null
          unit_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_visits_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_visits_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      review_tasks: {
        Row: {
          completed_at: string | null
          content: string | null
          created_at: string
          created_by: string
          id: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          id?: never
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          content?: string | null
          created_at?: string
          created_by?: string
          id?: never
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_logs: {
        Row: {
          action: string
          actor_id: number | null
          actor_name: string
          card_id: number | null
          card_name: string | null
          created_at: string
          details: Json
          event_date: string | null
          event_id: number | null
          event_title: string | null
          id: number
          session_id: number | null
          target_id: number | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: number | null
          actor_name: string
          card_id?: number | null
          card_name?: string | null
          created_at?: string
          details?: Json
          event_date?: string | null
          event_id?: number | null
          event_title?: string | null
          id?: number
          session_id?: number | null
          target_id?: number | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: number | null
          actor_name?: string
          card_id?: number | null
          card_name?: string | null
          created_at?: string
          details?: Json
          event_date?: string | null
          event_id?: number | null
          event_title?: string | null
          id?: number
          session_id?: number | null
          target_id?: number | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "service_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      service_sessions: {
        Row: {
          assigned_card_id: number | null
          assignment_id: number | null
          calendar_event_id: number | null
          created_at: string | null
          ended_at: string | null
          id: number
          memo: string
          primary_card_id: number | null
          role: string
          service_date: string
          source: string
          started_at: string
          status: string
          time_slot: string
          user_name: string
        }
        Insert: {
          assigned_card_id?: number | null
          assignment_id?: number | null
          calendar_event_id?: number | null
          created_at?: string | null
          ended_at?: string | null
          id?: number
          memo?: string
          primary_card_id?: number | null
          role?: string
          service_date?: string
          source?: string
          started_at?: string
          status?: string
          time_slot: string
          user_name: string
        }
        Update: {
          assigned_card_id?: number | null
          assignment_id?: number | null
          calendar_event_id?: number | null
          created_at?: string | null
          ended_at?: string | null
          id?: number
          memo?: string
          primary_card_id?: number | null
          role?: string
          service_date?: string
          source?: string
          started_at?: string
          status?: string
          time_slot?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_sessions_assigned_card_id_fkey"
            columns: ["assigned_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_sessions_calendar_event_id_fkey"
            columns: ["calendar_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_sessions_primary_card_id_fkey"
            columns: ["primary_card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
        ]
      }
      special_periods: {
        Row: {
          color: string
          created_at: string | null
          end_date: string
          id: number
          label: string
          start_date: string
        }
        Insert: {
          color?: string
          created_at?: string | null
          end_date: string
          id?: number
          label: string
          start_date: string
        }
        Update: {
          color?: string
          created_at?: string | null
          end_date?: string
          id?: number
          label?: string
          start_date?: string
        }
        Relationships: []
      }
      units: {
        Row: {
          building_id: number
          created_at: string | null
          id: number
          is_chinese: boolean
          memo: string | null
          number: string
          status: string
          usage_type: string | null
        }
        Insert: {
          building_id: number
          created_at?: string | null
          id?: number
          is_chinese?: boolean
          memo?: string | null
          number: string
          status?: string
          usage_type?: string | null
        }
        Update: {
          building_id?: number
          created_at?: string | null
          id?: number
          is_chinese?: boolean
          memo?: string | null
          number?: string
          status?: string
          usage_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_building_id_fkey"
            columns: ["building_id"]
            isOneToOne: false
            referencedRelation: "buildings"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_histories: {
        Row: {
          created_at: string | null
          id: number
          invitation_left: boolean | null
          memo: string | null
          result: string
          service_session_id: number | null
          special_period_id: number | null
          time_slot: string
          unit_id: number
          visited_at: string
          visitor_name: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          invitation_left?: boolean | null
          memo?: string | null
          result: string
          service_session_id?: number | null
          special_period_id?: number | null
          time_slot?: string
          unit_id: number
          visited_at?: string
          visitor_name: string
        }
        Update: {
          created_at?: string | null
          id?: number
          invitation_left?: boolean | null
          memo?: string | null
          result?: string
          service_session_id?: number | null
          special_period_id?: number | null
          time_slot?: string
          unit_id?: number
          visited_at?: string
          visitor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_histories_service_session_id_fkey"
            columns: ["service_session_id"]
            isOneToOne: false
            referencedRelation: "service_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_histories_special_period_id_fkey"
            columns: ["special_period_id"]
            isOneToOne: false
            referencedRelation: "special_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_histories_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deactivate_app_user_tx: {
        Args: { p_reason: string; p_token: string; p_user_id: number }
        Returns: Json
      }
      invalidate_return_visit_log_tx: {
        Args: { p_log_id: number; p_reason?: string; p_token: string }
        Returns: Json
      }
      update_return_visit_log_tx: {
        Args: { p_log_id: number; p_memo: string; p_reason?: string; p_result: string | null; p_token: string }
        Returns: Json
      }
      set_building_access_tx: {
        Args: {
          p_blocked: boolean
          p_building_id: number
          p_note?: string
          p_token: string
        }
        Returns: Json
      }
      create_return_visit_location_tx: {
        Args: {
          p_address: string
          p_building_name?: string
          p_building_type?: string
          p_card_id?: number
          p_display_name: string
          p_existing_building_id?: number
          p_first_result?: string
          p_lat?: number
          p_lng?: number
          p_memo?: string
          p_token: string
          p_unit_number?: string
          p_unit_usage_type?: string
        }
        Returns: Json
      }
      auth_login: {
        Args: {
          p_device_label?: string
          p_login_id: string
          p_pin: string
          p_user_agent?: string
        }
        Returns: {
          approval_status: string
          id: number
          login_id: string
          name: string
          role: string
          token: string
        }[]
      }
      can_access_chat_event: {
        Args: { p_event_id: number; p_user_id: number }
        Returns: boolean
      }
      cleanup_expired_auth_sessions: { Args: never; Returns: number }
      create_system_chat_message: {
        Args: { p_content: string; p_event_id: number; p_token: string }
        Returns: number
      }
      delete_chat_message: {
        Args: { p_message_id: number; p_token: string }
        Returns: undefined
      }
      delete_push_subscription: {
        Args: { p_endpoint: string; p_token: string }
        Returns: undefined
      }
      dispatch_push_notification: {
        Args: {
          p_body?: string
          p_link?: string
          p_related_id?: number
          p_title: string
          p_type: string
          p_user_ids: number[]
        }
        Returns: undefined
      }
      get_chat_message_meta: {
        Args: { p_event_ids: number[]; p_token: string }
        Returns: {
          author_id: number
          created_at: string
          event_id: number
        }[]
      }
      get_chat_message_previews: {
        Args: { p_event_ids: number[]; p_token: string }
        Returns: {
          author_name: string
          content: string
          created_at: string
          event_id: number
          id: number
          message_type: string
        }[]
      }
      get_chat_messages: {
        Args: { p_event_id: number; p_token: string }
        Returns: {
          author_id: number
          author_name: string
          content: string
          created_at: string
          deleted_at: string
          event_id: number
          id: number
          image_expired: boolean
          image_url: string
          mention_ids: number[]
          mention_names: string[]
          message_type: string
        }[]
      }
      get_comment_target_author_id: {
        Args: { p_target_id: number; p_target_type: string }
        Returns: number
      }
      get_login_logs: {
        Args: { p_limit?: number; p_since?: string; p_user_id: number }
        Returns: {
          id: number
          logged_in_at: string
        }[]
      }
      get_my_chat_reads: {
        Args: { p_token: string }
        Returns: {
          event_id: number
          last_read_at: string
          user_id: number
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_read_status"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_notification_prefs: {
        Args: { p_token: string }
        Returns: {
          push_chat: boolean
          push_comment: boolean
          push_event_change: boolean
          push_mention: boolean
          push_new_notice: boolean
          push_service_status: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          updated_at: string
          user_id: number
        }
        SetofOptions: {
          from: "*"
          to: "notification_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_notifications: {
        Args: { p_limit?: number; p_token: string }
        Returns: {
          body: string | null
          created_at: string
          id: number
          is_read: boolean
          link: string | null
          related_id: number | null
          title: string
          type: string
          user_id: number
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_service_logs: {
        Args: {
          p_filter_card_id?: number
          p_filter_event_id?: number
          p_limit?: number
          p_token: string
        }
        Returns: {
          action: string
          actor_id: number | null
          actor_name: string
          card_id: number | null
          card_name: string | null
          created_at: string
          details: Json
          event_date: string | null
          event_id: number | null
          event_title: string | null
          id: number
          session_id: number | null
          target_id: number | null
          target_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "service_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      insert_notifications: {
        Args: {
          p_body?: string
          p_link?: string
          p_related_id?: number
          p_title: string
          p_type: string
          p_user_ids: number[]
        }
        Returns: number
      }
      is_chat_locked: { Args: { p_event_id: number }; Returns: boolean }
      log_service_action: {
        Args: {
          p_action?: string
          p_card_id?: number
          p_details?: Json
          p_event_id?: number
          p_session_id?: number
          p_target_id?: number
          p_target_type?: string
          p_token: string
        }
        Returns: number
      }
      mark_all_notifications_read: {
        Args: { p_token: string }
        Returns: number
      }
      mark_notification_read: {
        Args: { p_notification_id: number; p_token: string }
        Returns: undefined
      }
      send_chat_image: {
        Args: {
          p_caption?: string
          p_event_id: number
          p_image_url: string
          p_mention_ids?: number[]
          p_mention_names?: string[]
          p_token: string
        }
        Returns: number
      }
      send_chat_message: {
        Args: {
          p_content: string
          p_event_id: number
          p_mention_ids?: number[]
          p_mention_names?: string[]
          p_token: string
        }
        Returns: number
      }
      update_chat_read: {
        Args: { p_event_id: number; p_token: string }
        Returns: undefined
      }
      update_my_notification_prefs: {
        Args: {
          p_push_chat: boolean
          p_push_comment: boolean
          p_push_event_change: boolean
          p_push_mention: boolean
          p_push_new_notice: boolean
          p_push_service_status: boolean
          p_quiet_hours_end?: string
          p_quiet_hours_start?: string
          p_token: string
        }
        Returns: undefined
      }
      upsert_push_subscription: {
        Args: {
          p_auth: string
          p_device_label?: string
          p_endpoint: string
          p_p256dh: string
          p_token: string
        }
        Returns: number
      }
      verify_session: { Args: { p_token: string }; Returns: number }
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
