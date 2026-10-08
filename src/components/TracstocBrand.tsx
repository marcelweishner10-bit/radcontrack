import { PackageOpen } from 'lucide-react';

export function TracstocBrand({ large = false }: { large?: boolean }) {
  return <span className="inline-flex items-center gap-3 max-w-full text-foreground">
    <PackageOpen aria-hidden="true" className={large ? 'h-10 w-10 text-primary' : 'h-8 w-8 text-primary'} />
    <span className={large ? 'text-3xl font-bold tracking-tight' : 'text-2xl font-bold tracking-tight'}>Tracstoc</span>
  </span>;
}
