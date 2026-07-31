module soulidity::animacraft_soul_binding_v5;

/// Exact cross-package witness accepted by Animacraft commerce v5 after its
/// defining TypeName has been pinned in CommerceProtocolConfigV5.
///
/// The field is private and the constructor is package-only. Production code
/// creates this value only after the reviewed Soulidity mint path has produced
/// the real Soul ID, then immediately consumes it in Animacraft's binding call.
public struct AnimacraftSoulBindingProofV5 has drop {
    minted_by_soulidity: bool,
}

public(package) fun new(): AnimacraftSoulBindingProofV5 {
    AnimacraftSoulBindingProofV5 {
        minted_by_soulidity: true,
    }
}
