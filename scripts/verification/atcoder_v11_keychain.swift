import Foundation
import Security

private let maximumRecordBytes = 20 * 1024
private let servicePrefix = "io.algoloom.verification.v11."
private let fixedAccount = "temporary-session-record"

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

private func parseGeneration(_ value: String) -> Data {
    guard value.range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else {
        fail("generation_invalid", 64)
    }
    return Data(value.utf8)
}

let arguments = CommandLine.arguments
guard arguments.count >= 4 else {
    fail("usage_invalid", 64)
}
let operation = arguments[1]
let service = arguments[2]
let account = arguments[3]
guard service.hasPrefix(servicePrefix), account == fixedAccount else {
    fail("scope_invalid", 64)
}

switch operation {
case "add":
    guard arguments.count == 5 else { fail("usage_invalid", 64) }
    let generation = parseGeneration(arguments[4])
    let record = FileHandle.standardInput.readDataToEndOfFile()
    guard !record.isEmpty, record.count <= maximumRecordBytes else {
        fail("record_size_invalid", 64)
    }
    var query = baseQuery(service: service, account: account)
    query[kSecAttrLabel as String] = "AlgoLoom V-11 temporary AtCoder session"
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    query[kSecAttrGeneric as String] = generation
    query[kSecValueData as String] = record
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { fail("keychain_add_failed") }

case "replace":
    guard arguments.count == 6 else { fail("usage_invalid", 64) }
    let expectedGeneration = parseGeneration(arguments[4])
    let nextGeneration = parseGeneration(arguments[5])
    let record = FileHandle.standardInput.readDataToEndOfFile()
    guard !record.isEmpty, record.count <= maximumRecordBytes else {
        fail("record_size_invalid", 64)
    }
    var query = baseQuery(service: service, account: account)
    query[kSecAttrGeneric as String] = expectedGeneration
    let updates: [String: Any] = [
        kSecAttrGeneric as String: nextGeneration,
        kSecValueData as String: record,
    ]
    let status = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
    if status == errSecItemNotFound {
        fail("keychain_generation_conflict", 45)
    }
    guard status == errSecSuccess else { fail("keychain_replace_failed") }

case "read":
    guard arguments.count == 4 else { fail("usage_invalid", 64) }
    var query = baseQuery(service: service, account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { exit(44) }
    guard status == errSecSuccess, let record = result as? Data else {
        fail("keychain_read_failed")
    }
    FileHandle.standardOutput.write(record)

case "delete":
    guard arguments.count == 4 else { fail("usage_invalid", 64) }
    let status = SecItemDelete(baseQuery(service: service, account: account) as CFDictionary)
    if status == errSecItemNotFound { exit(44) }
    guard status == errSecSuccess else { fail("keychain_delete_failed") }

case "exists":
    guard arguments.count == 4 else { fail("usage_invalid", 64) }
    var query = baseQuery(service: service, account: account)
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    if status == errSecItemNotFound { exit(44) }
    guard status == errSecSuccess else { fail("keychain_exists_failed") }

default:
    fail("operation_invalid", 64)
}
