type ProfileLoadErrorProps = {
  message: string
  retry: () => void
}

export function ProfileLoadError({ message, retry }: ProfileLoadErrorProps) {
  return (
    <div className="flex-1 flex items-center justify-center px-5">
      <div className="w-full max-w-sm flex flex-col items-center gap-4 text-center">
        <p className="text-[var(--color-text-muted)]">{message}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2.5 hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
