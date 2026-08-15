import Link from "next/link";
import { CalendarDays, CloudSun, Sunrise, Waves } from "lucide-react";

export default function Tomorrow() {
  return <main><div className="page-head"><div><p className="eyebrow">AMANHÃƒ Â· PLANEJAMENTO</p><h1>O prÃ³ximo melhor momento.</h1><p className="muted">Uma leitura rÃ¡pida para vocÃª separar a prancha e acertar o despertador.</p></div><span className="status-chip">PREVISÃƒO ATUALIZADA</span></div><section className="feature-grid">{[
    [Sunrise,"JANELA DE OURO","06:10 â€” 08:20","Mar mais liso e vento terral leve."],
    [Waves,"ONDULAÃ‡ÃƒO","1,1 m Â· 10 s","Swell de sul ganhando consistÃªncia."],
    [CloudSun,"CONDIÃ‡ÃƒO","BOM","Melhora cedo, perde qualidade apÃ³s 10h."],
    [CalendarDays,"DECISÃƒO","VALE ACORDAR","Tombo Ã© a aposta mais segura do dia."],
  ].map(([Icon,label,value,copy])=><article className="panel feature-card" key={String(label)}><Icon size={28}/><p className="eyebrow">{String(label)}</p><h2>{String(value)}</h2><p className="muted">{String(copy)}</p></article>)}</section><div className="cta-row"><Link className="btn" href="/app/spot/tombo">VER TOMBO AMANHÃƒ</Link><Link className="ghost-btn" href="/app/map">COMPARAR NO MAPA</Link></div></main>
}

