import { createManagementOriginalSourceRegistryV154, type ManagementOriginalSourceInstallationV154 } from './management/equipment-original-source-v154'
// Root-owned compiled acceptance only. No runtime/environment/URL/storage/file
// installer. This default remains empty until actual independent G1 acceptance.
const ROOT_ACCEPTED_MANAGEMENT_ORIGINAL_SOURCES: readonly ManagementOriginalSourceInstallationV154[] = []
const registry = createManagementOriginalSourceRegistryV154(ROOT_ACCEPTED_MANAGEMENT_ORIGINAL_SOURCES)
export function matchConfiguredManagementOriginalSource(input: Parameters<typeof registry.match>[0]) {
  return registry.match(input)
}
