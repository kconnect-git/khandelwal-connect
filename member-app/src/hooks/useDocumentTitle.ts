import { useEffect } from 'react'

/** Sets the tab title while the page is mounted, and puts the old one back
 * after -- the app's other screens don't set their own. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
