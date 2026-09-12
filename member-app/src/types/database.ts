export type Person = {
  id: string
  auth_user_id: string | null
  // full_name is derived from the three parts by the people_sync_full_name
  // trigger (0017) -- it's the display column every reader uses; the
  // parts are what the Profile page edits.
  full_name: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  gender: string | null
  dob: string | null
  gotra: string | null
  native_place: string | null
  current_district: string | null
  current_state: string | null
  state_code: string | null
  member_code: string | null
  current_city: string | null
  home_address: string | null
  marital_status: string | null
  education: string | null
  profile_photo_url: string | null
  mobile_number: string | null
  // Father/mother/spouse/maternal uncle/spouse's parents moved to the
  // family_relations table (post-3b). The 30 columns these replaced
  // (father_id, father_name, father_member_code, ... x6 slots) still
  // physically exist on this row as frozen historical data -- nothing
  // writes to them anymore -- but are deliberately left off this type so
  // nothing in the app reads stale values through Person. Use
  // getFamilyRelations()/getFamilyNameCompletionFlags() in
  // lib/familyDetails.ts instead.
  occupation_type: string | null
  job_title: string | null
  company_name: string | null
  job_location: string | null
  // Phase 3c (0017): Profile tabs. All never exposed to other members.
  blood_group: string | null
  secondary_email: string | null
  secondary_mobile: string | null
  residence_phone: string | null
  birth_place: string | null
  address_line2: string | null
  address_line3: string | null
  pincode: string | null
  date_of_marriage: string | null
  created_at: string
  updated_at: string
}

export type ChildRow = {
  id: string
  parent_person_id: string
  child_name: string
  child_member_code: string | null
  child_id: string | null
  child_mobile_number: string | null
  child_dob: string | null
  relation: string | null
  education: string | null
  profession: string | null
  marital_status: string | null
  spouse_name: string | null
  blood_group: string | null
  created_at: string
  updated_at: string
}

export type FamilyRelationSlot =
  | 'father'
  | 'mother'
  | 'spouse'
  | 'maternal_uncle'
  | 'spouse_father'
  | 'spouse_mother'

export type FamilyRelationRow = {
  id: string
  person_id: string
  slot: FamilyRelationSlot
  related_name: string | null
  related_member_code: string | null
  related_id: string | null
  mobile_number: string | null
  dob: string | null
  // Generic columns (0017), only rendered on the spouse card.
  email: string | null
  profession: string | null
  blood_group: string | null
  created_at: string
  updated_at: string
}

export type BusinessRow = {
  id: string
  owner_id: string
  name: string
  category: string | null
  description: string | null
  city: string | null
  state: string | null
  contact_phone: string | null
  website: string | null
  logo_url: string | null
  brand_name: string | null
  address_line1: string | null
  address_line2: string | null
  business_email: string | null
  primary_product: string | null
  business_type: string | null
  facebook_url: string | null
  instagram_url: string | null
  linkedin_url: string | null
  youtube_url: string | null
  created_at: string
  updated_at: string
}

// Phase 4 (0018). Nothing in the app writes these tables directly -- every
// write is an RPC (see lib/events.ts) -- so the Row types exist for the
// safety-net selects and for shape reference only.
export type EventStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'
export type EventVisibility = 'members' | 'invite_only'

export type EventRow = {
  id: string
  creator_id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  venue: string | null
  city: string | null
  state: string | null
  capacity: number | null
  visibility: EventVisibility
  status: EventStatus
  rejection_reason: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type RsvpRow = {
  id: string
  event_id: string
  person_id: string
  status: 'going' | 'not_going'
  created_at: string
  updated_at: string
}

export type EventInviteRow = {
  id: string
  event_id: string
  person_id: string
  invited_by: string
  emailed_at: string | null
  created_at: string
}

export type AdminRow = {
  auth_user_id: string
  created_at: string
}

/** The columns every event list RPC returns (cards). */
export type EventCardRow = {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  venue: string | null
  city: string | null
  state: string | null
  capacity: number | null
  visibility: EventVisibility
  status: EventStatus
  creator_id: string
  creator_name: string
  creator_photo_url: string | null
  creator_member_code: string
  going_count: number
  my_rsvp_status: 'going' | 'not_going' | null
}

type EventWriteArgs = {
  p_title: string
  p_description?: string | null
  p_starts_at?: string | null
  p_ends_at?: string | null
  p_venue?: string | null
  p_city?: string | null
  p_state?: string | null
  p_capacity?: number | null
  p_visibility?: string
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
      businesses: {
        Row: BusinessRow
        Insert: Partial<BusinessRow> & { owner_id: string; name: string }
        Update: Partial<BusinessRow>
        Relationships: []
      }
      children: {
        Row: ChildRow
        Insert: Partial<ChildRow> & { parent_person_id: string; child_name: string }
        Update: Partial<ChildRow>
        Relationships: []
      }
      family_relations: {
        Row: FamilyRelationRow
        Insert: Partial<FamilyRelationRow> & { person_id: string; slot: FamilyRelationSlot }
        Update: Partial<FamilyRelationRow>
        Relationships: []
      }
      events: {
        Row: EventRow
        Insert: never
        Update: never
        Relationships: []
      }
      rsvps: {
        Row: RsvpRow
        Insert: never
        Update: never
        Relationships: []
      }
      event_invites: {
        Row: EventInviteRow
        Insert: never
        Update: never
        Relationships: []
      }
      admins: {
        Row: AdminRow
        Insert: never
        Update: never
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
          mobile_number: string | null
        }[]
      }
      save_family_relation: {
        Args: {
          p_slot: string
          p_name: string
          p_member_code?: string | null
          p_mobile_number?: string | null
          p_dob?: string | null
          p_email?: string | null
          p_profession?: string | null
          p_blood_group?: string | null
        }
        Returns: undefined
      }
      add_child: {
        Args: {
          p_name: string
          p_member_code?: string | null
          p_mobile_number?: string | null
          p_dob?: string | null
          p_relation?: string | null
          p_education?: string | null
          p_profession?: string | null
          p_marital_status?: string | null
          p_spouse_name?: string | null
          p_blood_group?: string | null
        }
        Returns: string
      }
      update_child: {
        Args: {
          p_child_row_id: string
          p_name: string
          p_member_code?: string | null
          p_mobile_number?: string | null
          p_dob?: string | null
          p_relation?: string | null
          p_education?: string | null
          p_profession?: string | null
          p_marital_status?: string | null
          p_spouse_name?: string | null
          p_blood_group?: string | null
        }
        Returns: undefined
      }
      list_directory: {
        Args: {
          p_search?: string | null
          p_state?: string | null
          p_city?: string | null
          p_gotra?: string | null
          p_occupation?: string | null
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          id: string
          full_name: string
          gotra: string | null
          native_place: string | null
          current_city: string | null
          current_state: string | null
          member_code: string
          profile_photo_url: string | null
          occupation_type: string | null
          job_title: string | null
          company_name: string | null
          total_count: number
        }[]
      }
      get_member_profile: {
        Args: {
          p_person_id: string
        }
        Returns: {
          id: string
          full_name: string
          gotra: string | null
          native_place: string | null
          current_city: string | null
          current_district: string | null
          current_state: string | null
          member_code: string
          education: string | null
          marital_status: string | null
          mobile_number: string | null
          profile_photo_url: string | null
          occupation_type: string | null
          job_title: string | null
          company_name: string | null
          job_location: string | null
        }[]
      }
      directory_filter_options: {
        Args: Record<PropertyKey, never>
        Returns: {
          kind: string
          value: string
        }[]
      }
      list_businesses: {
        Args: {
          p_search?: string | null
          p_category?: string | null
          p_city?: string | null
          p_state?: string | null
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          id: string
          name: string
          category: string | null
          description: string | null
          city: string | null
          state: string | null
          contact_phone: string | null
          website: string | null
          logo_url: string | null
          owner_id: string
          owner_name: string
          owner_photo_url: string | null
          owner_member_code: string
          total_count: number
        }[]
      }
      get_business: {
        Args: {
          p_business_id: string
        }
        Returns: {
          id: string
          name: string
          category: string | null
          description: string | null
          city: string | null
          state: string | null
          contact_phone: string | null
          website: string | null
          logo_url: string | null
          brand_name: string | null
          address_line1: string | null
          address_line2: string | null
          business_email: string | null
          primary_product: string | null
          business_type: string | null
          facebook_url: string | null
          instagram_url: string | null
          linkedin_url: string | null
          youtube_url: string | null
          owner_id: string
          owner_name: string
          owner_photo_url: string | null
          owner_member_code: string
        }[]
      }
      list_member_businesses: {
        Args: {
          p_person_id: string
        }
        Returns: {
          id: string
          name: string
          category: string | null
          city: string | null
          logo_url: string | null
        }[]
      }
      business_filter_options: {
        Args: Record<PropertyKey, never>
        Returns: {
          kind: string
          value: string
        }[]
      }
      // Phase 4 (0018)
      is_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      list_events: {
        Args: {
          p_mode?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: (EventCardRow & { total_count: number })[]
      }
      list_my_events: {
        Args: Record<PropertyKey, never>
        Returns: (EventCardRow & {
          rejection_reason: string | null
          relation: 'created' | 'invited' | 'joined'
        })[]
      }
      get_event: {
        Args: {
          p_event_id: string
        }
        Returns: (EventCardRow & {
          rejection_reason: string | null
          approved_at: string | null
          created_at: string
          is_creator: boolean
          is_invited: boolean
          is_admin: boolean
          can_edit_all: boolean
          can_edit_description: boolean
          can_manage_invitees: boolean
        })[]
      }
      list_event_invitees: {
        Args: {
          p_event_id: string
        }
        Returns: {
          person_id: string
          full_name: string
          profile_photo_url: string | null
          member_code: string
          emailed_at: string | null
          created_at: string
        }[]
      }
      admin_list_events: {
        Args: {
          p_status?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: (EventCardRow & { rejection_reason: string | null; total_count: number })[]
      }
      save_event: {
        Args: EventWriteArgs
        Returns: string
      }
      update_event: {
        Args: EventWriteArgs & { p_event_id: string }
        Returns: undefined
      }
      cancel_event: {
        Args: {
          p_event_id: string
        }
        Returns: undefined
      }
      rsvp_event: {
        Args: {
          p_event_id: string
          p_status: string
        }
        Returns: number
      }
      add_event_invitee: {
        Args: {
          p_event_id: string
          p_person_id: string
        }
        Returns: undefined
      }
      remove_event_invitee: {
        Args: {
          p_event_id: string
          p_person_id: string
        }
        Returns: undefined
      }
      admin_set_event_status: {
        Args: {
          p_event_id: string
          p_status: string
          p_reason?: string | null
        }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
