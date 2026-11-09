import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
export const metadata: Metadata = {
  title: "วัดโหลดหม้อแปลง | น้ำพอง",
  description: "แผนที่งานวัดโหลดหม้อแปลงน้ำพอง 43 เครื่อง ติ๊กวัดแล้วและติดตามงานร่วมกัน",
  applicationName: "วัดโหลดน้ำพอง",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="th"><body>{children}</body></html>;
}
