export type SpinnerProps = {
    size?: number; // default value 16
};

const Spinner: React.FC<SpinnerProps> = ({ size }) => {
    const sizeClass = size ? `w-${size} h-${size}` : "w-16 h-16";
    return (
        <div className="flex justify-center">
            <div
                className={
                    "animate-spin rounded-full border-b-2 border-gray-400 " +
                    sizeClass
                }
            ></div>
        </div>
    );
};

export default Spinner;
