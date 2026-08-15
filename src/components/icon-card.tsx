import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export function IconCard({icon:Icon,kicker,title,text,href="#"}:{icon:LucideIcon;kicker:string;title:string;text:string;href?:string}){
 return <Link href={href} className="icon-card"><span className="icon-orb"><Icon size={22} strokeWidth={1.7}/></span><span><small>{kicker}</small><strong>{title}</strong><p>{text}</p></span><b className="arrow">â†—</b></Link>
}

