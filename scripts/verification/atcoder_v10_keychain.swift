import Foundation
import Security

private let maximumSecretBytes = 16 * 1024

private func fail(_ message: String, _ status: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(status)
}

private func baseQuery(service: String, account: String) -> [String: Any] {
    return [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
}

let arguments = CommandLine.arguments
guard arguments.count == 4 else {
    fail("usage_invalid", 64)
}
let operation = arguments[1]
let service = arguments[2]
let account = arguments[3]
guard service.hasPrefix("io.algoloom.verification.v10."),
      account == "temporary-session" else {
    fail("scope_invalid", 64)
}

switch operation {
case "add":
    let secret = FileHandle.standardInput.readDataToEndOfFile()
    guard !secret.isEmpty, secret.count <= maximumSecretBytes else {
        fail("secret_size_invalid", 64)
    }
    var query = baseQuery(service: service, account: account)
    query[kSecAttrLabel as String] = "AlgoLoom V-10 temporary AtCoder session"
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    query[kSecValueData as String] = secret
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
        fail("keychain_add_failed")
    }
case "read":
    var query = baseQuery(service: service, account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
        exit(44)
    }
    guard status == errSecSuccess, let secret = result as? Data else {
        fail("keychain_read_failed")
    }
    FileHandle.standardOutput.write(secret)
case "delete":
    let status = SecItemDelete(baseQuery(service: service, account: account) as CFDictionary)
    if status == errSecItemNotFound {
        exit(44)
    }
    guard status == errSecSuccess else {
        fail("keychain_delete_failed")
    }
case "exists":
    var query = baseQuery(service: service, account: account)
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    if status == errSecItemNotFound {
        exit(44)
    }
    guard status == errSecSuccess else {
        fail("keychain_exists_failed")
    }
default:
    fail("operation_invalid", 64)
}
