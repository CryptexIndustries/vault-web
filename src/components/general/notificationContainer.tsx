import { Flip, ToastContainer, ToastContainerProps } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const NotificationContainer: React.FC<
    ToastContainerProps & React.RefAttributes<HTMLDivElement>
> = (props) => {
    // <StackedContainer
    return (
        <ToastContainer
            position="bottom-center"
            autoClose={3000}
            {...props}
            theme="dark"
            transition={Flip}
        />
    );
};

export default NotificationContainer;
