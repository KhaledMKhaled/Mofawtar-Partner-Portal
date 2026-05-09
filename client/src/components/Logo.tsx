import { useTranslation } from "react-i18next";

export function Logo({ variant = "default" }: { variant?: "default" | "white" }) {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const text = isAr ? "مفوتر" : "MOFAWTAR";
  return <span className={"stamp-logo" + (variant === "white" ? " white" : "")}>{text}</span>;
}

export function LogoMark({ size = 40, color = "#4046B5" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform: "rotate(-3deg)" }}
    >
      <rect x="3" y="3" width="42" height="42" rx="10" stroke={color} strokeWidth="3" />
      <rect x="14" y="14" width="20" height="20" rx="3" transform="rotate(45 24 24)" fill={color} />
      <text
        x="24"
        y="29"
        textAnchor="middle"
        fontSize="14"
        fontWeight="800"
        fill="#fff"
        fontFamily="Inter, sans-serif"
      >
        M
      </text>
    </svg>
  );
}
