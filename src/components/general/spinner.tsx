export type SpinnerProps = {
    size?: number; // default value 16
};

const Spinner: React.FC<SpinnerProps> = ({}) => (
    <div className="flex justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-gray-400"></div>
    </div>
);

export default Spinner;
