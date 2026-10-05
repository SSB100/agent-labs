"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { HistoryPage } from "@/lib/core-ui/history-query";
function Pager({ page, name, label }: { page: HistoryPage; name: string; label: string }) {
  const path = usePathname(), query = useSearchParams();
  const href = (next: number) => { const params = new URLSearchParams(query); params.set(`${name}Page`, String(next)); params.delete("toolPage"); return `${path}?${params}`; };
  return <nav className="consoleRecentPager" aria-label={`${label} pages`}><span>{label}: {page.total === null ? "count unavailable" : `${page.total} total`} · page {page.page}</span>{page.page > 1 ? <Link href={href(page.page - 1)} scroll={false}>Previous {label}</Link> : null}{page.hasNext ? <Link href={href(page.page + 1)} scroll={false}>Next {label}</Link> : null}{!page.available ? <span role="status">Read unavailable or incomplete</span> : null}</nav>;
}

export function HistoryPager(props:{page?:HistoryPage;name:string;label:string}) { return props.page ? <Pager {...props} page={props.page}/> : null; }
