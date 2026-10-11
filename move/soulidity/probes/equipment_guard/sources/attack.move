module equipment_guard::attack;

use animacraft_v8_runtime::runtime_v8::SoulEquipmentUpdateV8;

/// An unfinished authorized mutation cannot be discarded and committed.
public fun abandon_update(guard: SoulEquipmentUpdateV8) {
    let _ = guard;
}
