import Testing
@testable import AutofillCore

@Test func readsApplesRuleFormat() {
    let rules = PasswordRules("required: upper; required: digit, [-_]; allowed: lower; max-consecutive: 2; minlength: 20; maxlength: 24;")
    #expect(rules.required == [Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), Set("0123456789-_")])
    #expect(rules.allowed == Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"))
    #expect(rules.minLength == 20 && rules.maxLength == 24 && rules.maxConsecutive == 2)
    // "]" is only a custom set's first character, and names ignore case.
    #expect(PasswordRules("Required: []a]").required == [Set("]a")])
    #expect(PasswordRules("required: [; ]; allowed: upper;").required == [Set("; ")])
    // Repeated limits keep the strictest.
    let repeated = PasswordRules("minlength: 12; minlength: 10; maxlength: 30; maxlength: 40; max-consecutive: 3; max-consecutive: 2;")
    #expect(repeated.minLength == 12 && repeated.maxLength == 30 && repeated.maxConsecutive == 2)
}

@Test func generatesPasswordsThatFollowTheRules() throws {
    let rules = PasswordRules("required: upper; required: [!]; allowed: lower; max-consecutive: 1; minlength: 30;")
    for _ in 0..<50 {
        let password = try #require(rules.password())
        #expect(password.count == 30)
        #expect(password.contains(where: \.isUppercase) && password.contains("!"))
        #expect(password.allSatisfy { $0.isUppercase || $0.isLowercase || $0 == "!" })
        #expect(zip(password, password.dropFirst()).allSatisfy { $0 != $1 })
    }
    #expect(PasswordRules("maxlength: 8;").password()?.count == 8)
    #expect(PasswordRules("").password()?.allSatisfy { $0.isLetter || $0.isNumber } == true)
}

@Test func givesUpOnRulesNoPasswordMeets() {
    #expect(PasswordRules("required: upper; required: lower; required: digit; maxlength: 2;").password() == nil)
    #expect(PasswordRules("required: [a]; max-consecutive: 1;").password() == nil)
    #expect(PasswordRules("required: [é];").password() == nil)
    #expect(PasswordRules("minlength: 20; maxlength: 8;").password() == nil)
    #expect(PasswordRules("minlength: 1000000000;").password() == nil)
}
