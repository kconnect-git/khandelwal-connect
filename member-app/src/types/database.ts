export type Person = {
  id: string
  auth_user_id: string | null
  full_name: string
  gender: string | null
  dob: string | null
  gotra: string | null
  native_place: string | null
  current_district: string | null
  current_state: string | null
  state_code: string | null
  member_code: string | null
  father_id: string | null
  mother_id: string | null
  spouse_id: string | null
  current_city: string | null
  home_address: string | null
  marital_status: string | null
  education: string | null
  profile_photo_url: string | null
  mobile_number: string | null
  created_at: string
  updated_at: string
}

export type Database = {
  public: {
    Tables: {
      people: {
        Row: Person
        Insert: Partial<Person> & { full_name: string }
        Update: Partial<Person>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      assign_member_code: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      complete_onboarding_step3: {
        Args: {
          p_gotra: string
          p_marital_status: string
          p_education: string
        }
        Returns: string
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
