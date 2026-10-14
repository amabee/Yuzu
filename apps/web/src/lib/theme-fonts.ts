import {
  Bricolage_Grotesque,
  Instrument_Sans,
  DM_Sans,
  Manrope,
  Outfit,
  Plus_Jakarta_Sans,
  Work_Sans,
  Public_Sans,
  Source_Sans_3,
  Nunito_Sans,
  IBM_Plex_Sans,
  Lora,
  Libre_Baskerville,
  DM_Serif_Display,
  Space_Grotesk,
  Roboto_Slab,
  Fraunces,
} from "next/font/google";
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--preview-display",
});
const ui = Instrument_Sans({ subsets: ["latin"], variable: "--preview-ui" });
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--preview-dm-sans",
  preload: false,
});
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--preview-manrope",
  preload: false,
});
const outfit = Outfit({
  subsets: ["latin"],
  variable: "--preview-outfit",
  preload: false,
});
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--preview-plus-jakarta-sans",
  preload: false,
});
const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--preview-work-sans",
  preload: false,
});
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--preview-public-sans",
  preload: false,
});
const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--preview-source-sans-3",
  preload: false,
});
const nunito = Nunito_Sans({
  subsets: ["latin"],
  variable: "--preview-nunito-sans",
  preload: false,
});
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--preview-ibm-plex-sans",
  preload: false,
});
const lora = Lora({
  subsets: ["latin"],
  variable: "--preview-lora",
  preload: false,
});
const baskerville = Libre_Baskerville({
  subsets: ["latin"],
  variable: "--preview-libre-baskerville",
  preload: false,
});
const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--preview-dm-serif-display",
  preload: false,
});
const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--preview-space-grotesk",
  preload: false,
});
const slab = Roboto_Slab({
  subsets: ["latin"],
  variable: "--preview-roboto-slab",
  preload: false,
});
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--preview-fraunces",
  preload: false,
});
export const themeFonts = [
  display,
  ui,
  dmSans,
  manrope,
  outfit,
  jakarta,
  workSans,
  publicSans,
  sourceSans,
  nunito,
  plex,
  lora,
  baskerville,
  dmSerif,
  space,
  slab,
  fraunces,
]
  .map((font) => font.variable)
  .join(" ");
