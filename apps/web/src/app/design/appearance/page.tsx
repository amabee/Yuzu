import { AppearancePreview } from "@/components/design-preview/appearance-preview";
import { themeFonts } from "@/lib/theme-fonts";
import "@/components/design-preview/appearance-preview.css";
export const metadata = {
  title: "Appearance design preview",
  robots: { index: false, follow: false },
};
export default function AppearanceDesignPage() {
  return <AppearancePreview fontClass={themeFonts} />;
}
