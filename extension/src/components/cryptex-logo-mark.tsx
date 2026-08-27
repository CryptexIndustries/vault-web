type CryptexLogoMarkProps = {
    className?: string;
};

export function CryptexLogoMark({ className }: CryptexLogoMarkProps) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            focusable="false"
            viewBox="0 0 64 64"
            xmlns="http://www.w3.org/2000/svg"
        >
            <path
                d="M32 3 59 18v28L32 61 5 46V18L32 3Z"
                fill="#283148"
                stroke="#ff5668"
                strokeLinejoin="miter"
                strokeWidth="4"
            />
            <g fill="#ff5668" opacity="0.62">
                <circle cx="32" cy="28" r="4" />
                <path d="M29 31 27 39h10l-2-8Z" />
            </g>
        </svg>
    );
}
