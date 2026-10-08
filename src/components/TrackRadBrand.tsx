export function TrackRadBrand({ large = false }: { large?: boolean }) {
  return <span className={`inline-flex rounded-xl bg-[oklch(0.97_0.008_175)] px-3 py-2 ${large ? 'w-64' : 'w-44'} max-w-full`}>
    <img src="/trackrad-logo.png" alt="TrackRad" width="2172" height="724" className="block w-full h-auto" />
  </span>;
}
