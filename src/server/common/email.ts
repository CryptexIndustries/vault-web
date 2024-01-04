import { env } from "../../env/server.mjs";

// Type for respose 200 from Infobip
/*
{
    "bulkId": "snxemd8u52v7v84iiu69",
    "messages": [
        {
            "to": "john.smith@somecompany.com",
            "messageId": "jgzra46v9zi1ztvd62t5",
            "status": {
                "groupId": 1,
                "groupName": "PENDING",
                "id": 26,
                "name": "PENDING_ACCEPTED",
                "description": "Message accepted, pending for delivery."
            }
        }
    ]
}
*/

// All other error responses
/*
{
    "requestError": {
        "serviceException": {
            "messageId": "BAD_REQUEST",
            "text": "Bad request"
        }
    }
}
*/

type InfobipEmailSendResponse = {
    bulkId?: string;
    messages?: [
        {
            to: string;
            messageId: string;
            status: {
                groupId: number;
                groupName: string;
                id: number;
                name: string;
                description: string;
            };
        },
    ];
    /*
     * In case we receive anything other than 200 OK, this will be populated with the error message.
     */
    requestError?: {
        serviceException: {
            messageId: string;
            text: string;
        };
    };
};

type InfobipEmailValidationResponse = {
    /*
     * The email address that was validated.
     */
    to: string;
    /*
     * Represents the status of the recipient email address.
     */
    validMailbox: "true" | "false" | "unknown";
    /*
     * Represents syntax of recipient email address.
     */
    validSyntax: boolean;
    /*
     * Is this an email address that accepts all emails sent to them.
     */
    catchAll: boolean;
    /*
     * Suggests a possible correction for the recipient email address.
     */
    didYouMean: boolean;
    /*
     * Whether or not the email address is disposable.
     */
    disposable: boolean;
    /*
     * Whether or not the email address is associated with a company/department/group of recipients instead of an individual.
     */
    roleBased: boolean;
    /**
     * INBOX_FULL - The user quota exceeded / The user inbox is full / The user doesn't accept any more requests.
     * UNEXPECTED_FAILURE - The mail Server returned a temporary error.
     * THROTTLED - The mail server is not allowing us momentarily because of too many requests.
     * TIMED_OUT - The Mail Server took a longer time to respond / there was a delay in the network.
     * TEMP_REJECTION - Mail server temporarily rejected.
     * UNABLE_TO_CONNECT - Unable to connect to the Mail Server.
     */
    reason?:
        | "INBOX_FULL"
        | "UNEXPECTED_FAILURE"
        | "THROTTLED"
        | "TIMED_OUT"
        | "TEMP_REJECTION"
        | "UNABLE_TO_CONNECT";
    /*
     * In case we receive anything other than 200 OK, this will be populated with the error message.
     */
    requestError?: {
        serviceException: {
            messageId:
                | "BAD_REQUEST"
                | "UNAUTHORIZED"
                | "TOO_MANY_REQUESTS"
                | "GENERAL_ERROR";
            text: string;
        };
    };
};

const sendEmailRequest = async (
    data: FormData,
): Promise<InfobipEmailSendResponse> => {
    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const response = await fetch(`${env.INFOBIP_BASE_URL}/email/3/send`, {
        method: "POST",
        headers: {
            Authorization: `App ${env.INFOBIP_API_KEY}`,
        },
        body: data,
    });

    return response.json();
};

export const tryValidateEmailAddress = async (
    to: string,
): Promise<InfobipEmailValidationResponse | null> => {
    if (!env.INFOBIP_EMAIL_VALIDATION) {
        return null;
    }

    if (!env.INFOBIP_BASE_URL || !env.INFOBIP_API_KEY) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const response = await fetch(`${env.INFOBIP_BASE_URL}/email/2/validation`, {
        method: "POST",
        headers: {
            Authorization: `App ${env.INFOBIP_API_KEY}`,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({
            to,
        }),
    });

    return response.json();
};

export const sendVerificationEmail = async (
    to: string,
    body: string,
): Promise<InfobipEmailSendResponse> => {
    if (!env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `CryptexVault <${env.EMAIL_SENDER}>`);
    data.append("to", to);
    // data.append("replyTo", "all.replies@somedomain.com");
    data.append("subject", "CryptexVault - Email Confirmation");
    // data.append(
    //     "text",
    //     "Dear {{name}}, this is mail body text with placeholder in body {{ph1}} "
    // );
    data.append("html", body);

    // data.append("attachment", "@files/image1.jpg");
    // data.append("bulkId", "customBulkId");
    // data.append("intermediateReport", "true");

    // data.append("defaultPlaceholders", '{"ph1": "Success"}');
    // data.append("notifyUrl", "https://www.example.com/email/advanced");
    // data.append("notifyContentType", "application/json");
    // data.append("callbackData", "DLR callback data");

    // var xhr = new XMLHttpRequest();
    // xhr.withCredentials = true;
    // xhr.addEventListener("readystatechange", function () {
    //     if (this.readyState === 4) {
    //         console.log(this.responseText);
    //     }
    // });
    // xhr.open("POST", `${env.INFOBIP_BASE_URL}/email/3/send`);
    // xhr.setRequestHeader("Authorization", `App ${env.INFOBIP_API_KEY}`);
    // xhr.send(data);

    return sendEmailRequest(data);
};

export const sendContactEmail = async (
    from: string,
    message: string,
): Promise<InfobipEmailSendResponse> => {
    if (!env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `CryptexVault <${env.EMAIL_CONTACT_US_SENDER}>`);
    data.append("to", env.EMAIL_CONTACT_US_RECEIVER);
    data.append("replyTo", from);
    data.append("subject", "CryptexVault - Contact Form Submission");
    data.append(
        "html",
        `
            <h1>Contact Form Submission</h1>
            <p><strong>From:</strong> ${from}</p>
            <br />
            <hr />
            <br />
            <p>${message}</p>
        `,
    );

    return sendEmailRequest(data);
};

export const sendFeedbackEmail = async (
    from: string,
    userID: string,
    reason: "Feature" | "Bug" | "General",
    message: string,
): Promise<InfobipEmailSendResponse> => {
    if (!env.EMAIL_SENDER) {
        throw new Error("[EMAIL] Infobip not configured. Skipping...");
    }

    const data = new FormData();
    data.append("from", `CryptexVault <${env.EMAIL_CONTACT_US_SENDER}>`);
    data.append("to", env.EMAIL_CONTACT_US_RECEIVER);
    data.append("replyTo", from);
    data.append("subject", "CryptexVault - Feedback Form Submission");
    data.append(
        "html",
        `
            <h1>Feedback Form Submission</h1>
            <p><strong>From:</strong> ${from} (${userID})</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <br />
            <hr />
            <br />
            <p>${message}</p>
        `,
    );

    return sendEmailRequest(data);
};
