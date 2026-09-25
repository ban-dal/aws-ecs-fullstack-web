import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "AWS 풀스택 실험실",
  description: "Next.js와 Terraform으로 운영하는 AWS 풀스택 실험실",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
