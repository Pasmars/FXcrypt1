export function Logo({ size = 34, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="overflow-hidden rounded-full shadow-glow ring-1 ring-white/10"
        style={{ width: size, height: size, minWidth: size }}
      >
        <img
          src="/logo.png"
          alt="FXcrypt logo"
          draggable={false}
          className="h-full w-full object-cover"
          style={{ objectPosition: '50% 22%' }}
        />
      </div>
      {withText && (
        <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-lg font-extrabold tracking-tight text-transparent">
          FXCRYPT
        </span>
      )}
    </div>
  );
}
