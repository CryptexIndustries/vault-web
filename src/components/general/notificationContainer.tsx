import { ToastContainer, ToastContainerProps } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const NotificationContainer: React.FC<
    ToastContainerProps & React.RefAttributes<HTMLDivElement>
> = (props) => {
    return (
        <ToastContainer
            {...props}
            theme="dark"
            position="bottom-center"
            autoClose={7000}
        />
    );
};

export default NotificationContainer;
