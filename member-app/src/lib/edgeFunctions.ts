import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../utils/supabase'

/** Calls an Edge Function and surfaces the real error message.
 *
 * supabase-js collapses any non-2xx response into a generic "Edge Function
 * returned a non-2xx status code" -- the actual reason is in the response
 * body (`{ error }`), reachable via error.context. Every function in this
 * project uses that body shape, so unwrap it here once. */
export async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message = error.message
      try {
        const payload = await error.context.json()
        if (payload?.error) message = payload.error
      } catch {
        // response wasn't JSON -- fall back to the generic message
      }
      throw new Error(message)
    }
    throw error
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error))
  }
  return data as T
}
