module soul_object::market_bootstrap;

use std::option;
use std::string::String;
use soul_object::soul::{Self as soul, Soul, SoulPackageAuthority};
use unft_standard::unft_standard::{Self as unft, NftBurnCap, NftCollectionMetadataCap, NftMintCap, NftRegistry};

public fun create_collection(
    authority: &SoulPackageAuthority,
    registry: &mut NftRegistry,
    name: String,
    description: String,
    image_url: String,
    ctx: &mut TxContext,
): (
    NftMintCap<Soul>,
    option::Option<NftBurnCap<Soul>>,
    NftCollectionMetadataCap<Soul>,
) {
    unft::create_collection_v2<Soul>(
        soul::publisher(authority),
        registry,
        name,
        description,
        image_url,
        option::none(),
        0,
        option::none(),
        false,
        false,
        false,
        ctx,
    )
}
