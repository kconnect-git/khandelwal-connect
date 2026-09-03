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
  father_name: string | null
  father_member_code: string | null
  mother_name: string | null
  mother_member_code: string | null
  spouse_name: string | null
  spouse_member_code: string | null
  maternal_uncle_id: string | null
  maternal_uncle_name: string | null
  maternal_uncle_member_code: string | null
  spouse_father_id: string | null
  spouse_father_name: string | null
  spouse_father_member_code: string | null
  spouse_mother_id: string | null
  spouse_mother_name: string | null
  spouse_mother_member_code: string | null
  created_at: string
  updated_at: string
}

export type ChildRow = {
  id: string
  parent_person_id: string
  child_name: string
  child_member_code: string | null
  child_id: string | null
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
      children: {
        Row: ChildRow
        Insert: Partial<ChildRow> & { parent_person_id: string; child_name: string }
        Update: Partial<ChildRow>
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
      search_registered_members: {
        Args: {
          p_full_name: string
          p_gotra?: string | null
          p_native_place?: string | null
        }
        Returns: {
          id: string
          full_name: string
          gotra: string | null
          native_place: string | null
          current_city: string | null
          current_state: string | null
          member_code: string
        }[]
      }
      save_family_relation: {
        Args: {
          p_slot: string
          p_name: string
          p_member_code?: string | null
        }
        Returns: undefined
      }
      add_child: {
        Args: {
          p_name: string
          p_member_code?: string | null
        }
        Returns: string
      }
      update_child: {
        Args: {
          p_child_row_id: string
          p_name: string
          p_member_code?: string | null
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
